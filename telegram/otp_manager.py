import os
import json
import secrets
import asyncio
from datetime import datetime, timedelta
from pathlib import Path
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional, Dict, Any
import ssl


class OTPManager:
    def __init__(self):
        self.otp_storage_path = Path('./otp_storage')
        self.otp_storage_path.mkdir(exist_ok=True)

        # Hostinger email configuration
        self.smtp_server = os.getenv('SMTP_SERVER', 'smtp.hostinger.com')
        self.smtp_port = int(os.getenv('SMTP_PORT', '465'))
        self.sender_email = os.getenv('EMAIL_USER')
        self.sender_password = os.getenv('EMAIL_PASSWORD')

    def generate_otp(self, length: int = 6) -> str:
        """Generate a numeric OTP"""
        return 123456
        return ''.join(secrets.choice('0123456789') for _ in range(length))

    def save_otp(self, email: str, otp: str, purpose: str, telegram_id: str = None) -> str:
        """Save OTP to file with expiration"""
        otp_data = {
            'otp': otp,
            'email': email,
            'purpose': purpose,
            'telegram_id': telegram_id,
            'created_at': datetime.now().isoformat(),
            'expires_at': (datetime.now() + timedelta(minutes=10)).isoformat(),  # 10 minutes expiry
            'used': False
        }

        otp_id = secrets.token_hex(8)
        otp_file = self.otp_storage_path / f"{otp_id}.json"

        with open(otp_file, 'w') as f:
            json.dump(otp_data, f, indent=2)

        return otp_id


    def verify_otp(self, otp_id: str, otp_code: str) -> Dict[str, Any]:
        """Verify OTP and return data if valid"""
        try:
            otp_file = self.otp_storage_path / f"{otp_id}.json"

            if not otp_file.exists():
                return {'valid': False, 'error': 'OTP not found or expired'}

            with open(otp_file, 'r') as f:
                otp_data = json.load(f)

            # Check if expired
            expires_at = datetime.fromisoformat(otp_data['expires_at'])
            if datetime.now() > expires_at:
                otp_file.unlink()
                return {'valid': False, 'error': 'OTP expired'}

            # Check if already used
            if otp_data.get('used', False):
                return {'valid': False, 'error': 'OTP already used'}

            # Check if OTP matches
            if otp_data['otp'] != otp_code:
                return {'valid': False, 'error': 'Invalid OTP code'}

            # Mark as used
            otp_data['used'] = True
            otp_data['used_at'] = datetime.now().isoformat()
            with open(otp_file, 'w') as f:
                json.dump(otp_data, f, indent=2)

            return {
                'valid': True,
                'email': otp_data['email'],
                'purpose': otp_data['purpose'],
                'telegram_id': otp_data.get('telegram_id')
            }

        except Exception as e:
            return {'valid': False, 'error': 'Verification error'}

    async def send_otp_email(self, email: str, otp: str, purpose: str) -> bool:
        """Send OTP email using Hostinger SMTP"""
        if not all([self.sender_email, self.sender_password]):
            return False

        try:
            if purpose == 'registration':
                subject = "Tovira App - Email Verification Code"
                body = f"""
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                        .header {{ background: #007bff; color: white; padding: 20px; text-align: center; }}
                        .content {{ padding: 20px; background: #f9f9f9; }}
                        .otp-code {{ font-size: 32px; font-weight: bold; text-align: center; color: #007bff; margin: 20px 0; }}
                        .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #666; }}
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>Tovira App</h1>
                        </div>
                        <div class="content">
                            <h2>Email Verification</h2>
                            <p>Hello,</p>
                            <p>Your verification code for Tovira App is:</p>
                            <div class="otp-code">{otp}</div>
                            <p>This code will expire in <strong>10 minutes</strong>.</p>
                            <p>If you didn't request this verification, please ignore this email.</p>
                        </div>
                        <div class="footer">
                            <p>Best regards,<br>Tovira App Team</p>
                        </div>
                    </div>
                </body>
                </html>
                """
            else:  # password_reset
                subject = "Tovira App - Password Reset Code"
                body = f"""
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                        .header {{ background: #dc3545; color: white; padding: 20px; text-align: center; }}
                        .content {{ padding: 20px; background: #f9f9f9; }}
                        .otp-code {{ font-size: 32px; font-weight: bold; text-align: center; color: #dc3545; margin: 20px 0; }}
                        .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #666; }}
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>Tovira App</h1>
                        </div>
                        <div class="content">
                            <h2>Password Reset</h2>
                            <p>Hello,</p>
                            <p>Your password reset code for Tovira App is:</p>
                            <div class="otp-code">{otp}</div>
                            <p>This code will expire in <strong>10 minutes</strong>.</p>
                            <p>If you didn't request a password reset, please ignore this email.</p>
                        </div>
                        <div class="footer">
                            <p>Best regards,<br>Tovira App Team</p>
                        </div>
                    </div>
                </body>
                </html>
                """

            # Create message
            msg = MIMEMultipart()
            msg['From'] = f"Tovira App <{self.sender_email}>"
            msg['To'] = email
            msg['Subject'] = subject

            # Attach HTML body
            msg.attach(MIMEText(body, 'html'))

            # Send email in thread to avoid blocking
            def send_sync():
                try:
                    # Create SSL context
                    context = ssl.create_default_context()

                    # Connect to Hostinger SMTP server
                    with smtplib.SMTP_SSL(self.smtp_server, self.smtp_port, context=context) as server:
                        server.login(self.sender_email, self.sender_password)
                        server.send_message(msg)

                    return True

                except smtplib.SMTPAuthenticationError:
                    return False
                except smtplib.SMTPException:
                    return False
                except Exception:
                    return False

            # Run in thread pool
            loop = asyncio.get_event_loop()
            success = await loop.run_in_executor(None, send_sync)

            return success

        except Exception:
            return False

    def cleanup_expired_otps(self):
        """Clean up expired OTPs - run this periodically"""
        try:
            current_time = datetime.now()
            cleaned_count = 0

            for otp_file in self.otp_storage_path.glob("*.json"):
                try:
                    with open(otp_file, 'r') as f:
                        otp_data = json.load(f)

                    expires_at = datetime.fromisoformat(otp_data['expires_at'])
                    if current_time > expires_at:
                        otp_file.unlink()
                        cleaned_count += 1

                except Exception:
                    # Remove corrupted files
                    try:
                        otp_file.unlink()
                    except:
                        pass

        except Exception:
            pass


# Global OTP manager instance
otp_manager = OTPManager()