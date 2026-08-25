import base64
import hashlib
from cryptography.fernet import Fernet, InvalidToken
from ..config import settings

_key = hashlib.sha256(settings.encryption_key.encode("utf-8")).digest()
_fernet = Fernet(base64.urlsafe_b64encode(_key))

def encrypt_secret(value: str) -> str:
    return _fernet.encrypt(value.encode("utf-8")).decode("utf-8")

def decrypt_secret(value: str) -> str:
    try:
        return _fernet.decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("Stored credential could not be decrypted.") from exc
