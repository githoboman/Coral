# Registration Error Logs

This directory contains detailed error logs for the Telegram bot registration system.

## Log Files

### `registration_errors.log`
Contains all errors that occur during the registration process, including:
- Password setup failures
- Encryption key generation errors
- Wallet creation failures
- Blockchain registration issues
- Session creation problems
- Data encryption/upload errors

## Log Format

Each log entry includes:
- **Timestamp**: When the error occurred
- **Logger Name**: TelegramRegistration
- **Level**: ERROR, WARNING, INFO, or DEBUG
- **Function**: Which function the error occurred in
- **Line Number**: Exact line where the error happened
- **Error Message**: Description of what went wrong
- **Full Traceback**: Complete stack trace for debugging

## Example Log Entry

```
2025-12-01 14:23:45,678 - TelegramRegistration - ERROR - [complete_registration:582] - Registration failed for user 123456789: Invalid wallet data
Traceback: Traceback (most recent call last):
  File "/path/to/Telegrambot_change.py", line 580, in complete_registration
    wallet_blob_id = key_manager.store_encrypted_object(wallet_data, telegram_id, password)
ValueError: Invalid wallet data
```

## Monitoring

To monitor errors in real-time:
```bash
tail -f logs/registration_errors.log
```

To search for specific user errors:
```bash
grep "user 123456789" logs/registration_errors.log
```

To count errors by type:
```bash
grep "ERROR" logs/registration_errors.log | wc -l
```

## Log Rotation

Consider implementing log rotation to prevent files from growing too large:
- Use Python's `logging.handlers.RotatingFileHandler`
- Set max file size (e.g., 10MB)
- Keep last 5 backup files

## Privacy Note

⚠️ **IMPORTANT**: These logs may contain sensitive debugging information. 
- Never commit logs to version control
- Ensure proper file permissions (600 or 640)
- Regularly review and clean old logs
- Redact any sensitive data before sharing logs
