import { randomUUID } from 'node:crypto';
import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { canMicromanage } from '../services/permissions.js';
import { parseAssistantTurn, parseSummary, stripNulls } from '../../ai-testing/preGP/shared/ai-contracts.ts';
import { profileFingerprint, verifyEvidence } from '../../ai-testing/preGP/shared/evidence.ts';
import { turnMessages, summaryMessages, repairMessages, promptVersion } from '../../ai-testing/preGP/backend/prompts.ts';
import { turnSchema, summarySchema } from '../../ai-testing/preGP/backend/schemas.ts';
import { relinkCitations, resolveCitations, tagTranscript } from '../../ai-testing/preGP/backend/citations.ts';
import { createAiClient, providerModel, providerModelOptions } from './providers.js';

const guildConfigurations = new Map();
const conversations = new Map();

function sessionKey(guildId, channelId, userId) {
  return `${guildId}:${channelId}:${userId}`;
}

function profileFor(user) {
  const name = (user.username || user.globalName || 'there').replace(/@/g, '@\u200b').slice(0, 80);
  return {
    id: user.id, name, preferredName: name, dateOfBirth: '', email: '', phone: '',
    pronouns: '', conditions: '', medications: '', allergies: '',
  };
}

function patientMessages(messages) {
  return messages.filter((message) => message.role === 'patient');
}

async function sendLong(channel, content) {
  const text = String(content || '').trim() || 'The AI did not return any text.';
  for (let index = 0; index < text.length; index += 1900) {
    await channel.send({ content: text.slice(index, index + 1900), allowedMentions: { parse: [] } });
  }
}

function evidenceSuffix(evidence, messages) {
  if (!evidence?.length) return '';
  const tags = new Map();
  let count = 0;
  for (const message of messages) {
    if (message.role === 'patient') tags.set(message.id, `P${++count}`);
  }
  return evidence.map((ref) => {
    const source = ref.source === 'message' ? (tags.get(ref.ref) || 'unverified') : `profile:${ref.ref}`;
    return `${source}: “${ref.quote}”`;
  }).join('; ');
}

function renderSummary(summary, messages, verification, patientName) {
  const complaintEvidence = evidenceSuffix(summary.presentingComplaint.evidence, messages);
  const lines = [`**GP-only preassessment — ${patientName}**`, '', summary.narrative, '', `**Presenting concern:** ${summary.presentingComplaint.value}${complaintEvidence ? `\n_${complaintEvidence}_` : ''}`];
  const addFindings = (title, entries) => {
    if (!entries?.length) return;
    lines.push('', `**${title}**`);
    for (const entry of entries) {
      const label = entry.label || entry.id || entry.flag || entry.point || 'Item';
      const value = entry.value || entry.status || entry.point || '';
      const citations = evidenceSuffix(entry.evidence, messages);
      lines.push(`• ${label}: ${value}${entry.reasoning ? ` — ${entry.reasoning}` : ''}${citations ? `\n  _${citations}_` : ''}`);
    }
  };
  addFindings('History', summary.history);
  addFindings('Red flags', summary.redFlags);
  addFindings('Background', summary.background);
  addFindings('Impact', summary.impact);
  if (summary.suggestedFocus.length) {
    lines.push('', '**Suggested areas to discuss with the GP**');
    for (const point of summary.suggestedFocus) {
      const citations = evidenceSuffix(point.evidence, messages);
      lines.push(`• ${point.point}${point.reasoning ? ` — ${point.reasoning}` : ''}${citations ? `\n  _${citations}_` : ''}`);
    }
  }
  if (summary.gaps.length) lines.push('', `**Not covered or unclear:** ${summary.gaps.join('; ')}`);
  lines.push('', `Citations verified: ${verification.verified}/${verification.total}.`);
  if (verification.failures.length) lines.push(`Unverified citations: ${verification.failures.length}.`);
  return lines.join('\n');
}

async function modelCall(session, schemaName, schema, messages, maxTokens, temperature) {
  const config = guildConfigurations.get(session.guildId);
  if (!config) throw new Error('The AI provider was cleared. Ask a server administrator to run `/gitwatcher ai-api` again.');
  return createAiClient(config).chatJson({ schemaName, schema, messages, maxTokens, temperature });
}

async function nextTurn(session) {
  const result = await modelCall(session, 'pregp_turn', turnSchema,
    turnMessages(session.profile, session.messages, []), 700, 0.8);
  const turn = parseAssistantTurn(result.content);
  if (!session.messages.length) {
    const name = session.profile.preferredName || 'there';
    turn.text = `Kia ora ${name}. What would you like to talk about today? Tell me in your own words.`;
    turn.questionId = 'concern';
    turn.complete = false;
    turn.input = { kind: 'text', placeholder: 'Reply in your own words.' };
    turn.phase = 'concern';
  }
  return turn;
}

async function sendTurn(session, turn) {
  session.messages.push({
    id: randomUUID(), role: 'assistant', text: turn.text, createdAt: new Date().toISOString(),
    ...(turn.questionId ? { questionId: turn.questionId } : {}),
    ...(turn.input ? { input: turn.input } : {}), phase: turn.phase,
  });
  if (!session.stopped) await sendLong(session.channel, `**PreGP · ${session.profile.preferredName}:** ${turn.text}`);
}

async function finishSession(session) {
  if (!patientMessages(session.messages).length) return;
  const tagged = tagTranscript(session.messages);
  const prompt = summaryMessages(session.profile, tagged.lines);
  const first = await modelCall(session, 'pregp_summary', summarySchema, prompt, 3000, 0.2);
  const finish = (content, model) => {
    const draft = resolveCitations(stripNulls(content), tagged.ids);
    return relinkCitations(parseSummary({
      ...draft,
      version: 2,
      source: 'ai',
      model: `${model} · prompt ${promptVersion}`,
      generatedAt: new Date().toISOString(),
      profileFingerprint: profileFingerprint(session.profile),
    }), session.messages);
  };
  let summary = finish(first.content, first.model);
  let report = verifyEvidence(summary, session.messages, session.profile);
  if (report.failures.length) {
    try {
      const repaired = await modelCall(session, 'pregp_summary', summarySchema,
        repairMessages(prompt, first.content, report.failures.map((failure) => ({
          location: failure.location, reason: failure.reason, quote: failure.ref.quote,
        }))), 3000, 0.1);
      const candidate = finish(repaired.content, repaired.model);
      const candidateReport = verifyEvidence(candidate, session.messages, session.profile);
      if (candidateReport.failures.length <= report.failures.length) {
        summary = candidate;
        report = candidateReport;
      }
    } catch (error) {
      console.warn('PreGP summary citation repair failed:', error.message);
    }
  }
  if (!session.stopped) await sendLong(session.channel, renderSummary(summary, session.messages, report, session.profile.preferredName));
}

async function stopWithPreassessment(session) {
  try {
    if (patientMessages(session.messages).length) {
      await finishSession(session);
    } else {
      await sendLong(session.channel, `No GP preassessment was generated for ${session.profile.preferredName} because they had not answered any questions.`);
    }
  } finally {
    session.stopped = true;
    conversations.delete(session.key);
  }
}

async function runTurn(session, patientText = undefined) {
  if (session.processing) return;
  session.processing = true;
  try {
    if (patientText !== undefined) {
      session.messages.push({
        id: randomUUID(), role: 'patient', text: patientText, createdAt: new Date().toISOString(),
        questionId: session.lastQuestionId || 'concern', value: patientText, source: 'typed',
      });
    }
    const turn = await nextTurn(session);
    if (session.stopRequested) {
      await stopWithPreassessment(session);
      return;
    }
    if (session.stopped) return;
    session.lastQuestionId = turn.questionId;
    await sendTurn(session, turn);
    if (session.stopRequested) {
      await stopWithPreassessment(session);
      return;
    }
    if (turn.complete) {
      try {
        await finishSession(session);
      } finally {
        conversations.delete(session.key);
      }
    }
  } catch (error) {
    console.error('PreGP Discord chat failed:', error);
    if (session.stopRequested) {
      if (!session.stopped) {
        try {
          await stopWithPreassessment(session);
        } catch (preassessmentError) {
          console.error('PreGP stopchat preassessment failed:', preassessmentError);
          await sendLong(session.channel, `GitWatcher could not generate the GP-only preassessment: ${preassessmentError.message}`);
          session.stopped = true;
          conversations.delete(session.key);
        }
      } else {
        await sendLong(session.channel, `GitWatcher could not generate the GP-only preassessment: ${error.message}`);
      }
      return;
    }
    if (!session.messages.some((message) => message.role === 'assistant')) conversations.delete(session.key);
    if (!session.stopped) await sendLong(session.channel, `PreGP for ${session.profile.preferredName} couldn’t get an AI response: ${error.message}`);
  } finally {
    session.processing = false;
  }
}

export async function startAiChat(interaction) {
  if (!interaction.guildId || !interaction.guild || !interaction.channel?.isTextBased()) {
    return interaction.reply({ content: 'Start a chat in a server text channel.', ephemeral: true });
  }
  if (!guildConfigurations.has(interaction.guildId)) {
    return interaction.reply({ content: 'A server manager must configure `/gitwatcher ai-api` first.', ephemeral: true });
  }
  const key = sessionKey(interaction.guildId, interaction.channelId, interaction.user.id);
  if (conversations.has(key)) {
    return interaction.reply({ content: 'You already have a PreGP chat in this channel. Use `/gitwatcher stopchat` first.', ephemeral: true });
  }
  const session = {
    key, guildId: interaction.guildId, channel: interaction.channel,
    profile: profileFor(interaction.user), messages: [], lastQuestionId: null,
    processing: false, stopRequested: false, stopped: false,
  };
  conversations.set(key, session);
  await interaction.reply({
    content: `Starting a PreGP chat for <@${interaction.user.id}> in this channel.`,
    allowedMentions: { users: [interaction.user.id] },
  });
  await runTurn(session);
}

export async function stopAiChat(interaction) {
  const key = sessionKey(interaction.guildId, interaction.channelId, interaction.user.id);
  const session = conversations.get(key);
  if (!session) return interaction.reply({ content: 'You do not have an active PreGP chat in this channel.', ephemeral: true });
  session.stopRequested = true;
  if (session.processing) {
    return interaction.reply({ content: 'I’ll finish the current AI request, then post the GP-only preassessment in this channel.', ephemeral: true });
  }
  session.processing = true;
  await interaction.reply({ content: 'Your chat is stopped. I’m preparing the GP-only preassessment in this channel.', ephemeral: true });
  try {
    await stopWithPreassessment(session);
  } catch (error) {
    console.error('PreGP stopchat preassessment failed:', error);
    await sendLong(session.channel, `GitWatcher could not generate the GP-only preassessment: ${error.message}`);
    session.stopped = true;
    conversations.delete(session.key);
  } finally {
    session.processing = false;
  }
  return;
}

export async function handleAiChatMessage(message) {
  if (!message.guildId || !message.guild || message.author.bot) return false;
  const session = conversations.get(sessionKey(message.guildId, message.channelId, message.author.id));
  if (!session) return false;
  if (session.processing) {
    await message.reply({ content: 'I’m still preparing the previous response. Please wait a moment.', allowedMentions: { parse: [] } });
    return true;
  }
  const text = message.content.trim();
  if (!text) return true;
  await runTurn(session, text.slice(0, 4000));
  return true;
}

export async function showAiApiModal(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Configure an AI provider from a server.', ephemeral: true });
  if (!(await canMicromanage(interaction))) {
    return interaction.reply({ content: 'You need Administrator permission or the GitWatcher Micromanager role.', ephemeral: true });
  }
  const current = guildConfigurations.get(interaction.guildId);
  const selectedProvider = current?.provider;
  const selectedModel = current?.model || (current?.provider ? providerModel(current.provider) : undefined);
  const options = [
    ['bedrock', 'Bedrock', 'Use an Amazon Bedrock API key.'],
    ['openai', 'OpenAI', 'Use an OpenAI API key.'],
    ['claude', 'Claude', 'Use an Anthropic API key.'],
  ].map(([value, label, description]) => ({ value, label, description, ...(value === selectedProvider ? { default: true } : {}) }));
  const provider = new StringSelectMenuBuilder()
    .setCustomId('provider').setPlaceholder('Choose an AI provider').setMinValues(1).setMaxValues(1).setRequired(true).addOptions(options);
  const model = new StringSelectMenuBuilder()
    .setCustomId('model').setPlaceholder('Choose a model').setMinValues(1).setMaxValues(1).setRequired(true)
    .addOptions(providerModelOptions.map((option) => ({
      label: option.label,
      value: option.modelId,
      description: option.modelId,
      ...(option.modelId === selectedModel ? { default: true } : {}),
    })));
  const key = new TextInputBuilder()
    .setCustomId('key').setStyle(TextInputStyle.Short).setPlaceholder('Paste your provider API key')
    .setRequired(true).setMaxLength(1000);
  const modal = new ModalBuilder().setCustomId('gw:ai-api-modal').setTitle('Configure PreGP AI')
    .addLabelComponents(
      new LabelBuilder().setLabel('AI provider').setStringSelectMenuComponent(provider),
      new LabelBuilder().setLabel('AI model').setStringSelectMenuComponent(model),
      new LabelBuilder().setLabel('API key').setTextInputComponent(key),
    );
  return interaction.showModal(modal);
}

export async function handleAiApiModal(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Configure an AI provider from a server.', ephemeral: true });
  if (!(await canMicromanage(interaction))) {
    return interaction.reply({ content: 'You are not allowed to configure this server’s AI provider.', ephemeral: true });
  }
  const provider = interaction.fields.getStringSelectValues('provider')[0];
  const model = interaction.fields.getStringSelectValues('model')[0];
  const key = interaction.fields.getTextInputValue('key').trim();
  const modelOption = providerModelOptions.find((option) => option.modelId === model);
  if (!['bedrock', 'openai', 'claude'].includes(provider) || !modelOption || modelOption.provider !== provider || !key) {
    return interaction.reply({ content: 'Choose a model from the selected provider and enter a non-empty API key.', ephemeral: true });
  }
  guildConfigurations.set(interaction.guildId, { provider, model, key });
  return interaction.reply({
    content: `✅ ${modelOption.label} is configured for this server until GitWatcher restarts. Re-running this command replaces the provider, model, and key.`,
    ephemeral: true,
  });
}
