const NZ_TIME_ZONE = 'Pacific/Auckland';

export function formatNzTimestamp(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: NZ_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  })
    .formatToParts(new Date(value))
    .reduce((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});

  return `${parts.day} ${parts.month} ${parts.year}, ` +
    `${parts.hour}:${parts.minute} ${parts.dayPeriod} ${parts.timeZoneName}`;
}
