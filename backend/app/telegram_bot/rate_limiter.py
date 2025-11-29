"""
Rate limiting for security operations
"""
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Optional


class RateLimiter:
    """
    Rate limiter for security-sensitive operations
    """

    def __init__(self):
        self.attempts = defaultdict(list)
        self.locked_out = {}

        # Configuration - Strict limits for security operations
        self.max_attempts = 3  # Only 3 attempts per hour
        self.lockout_duration = 3600  # 1 hour lockout
        self.window_hours = 1  # Time window for attempts

    def check_rate_limit(self, identifier: str, operation: str = "default") -> tuple[bool, Optional[str]]:
        """
        Check if operation is allowed for identifier.

        Returns: (allowed, error_message)
        """
        now = datetime.now()
        key = f"{identifier}:{operation}"

        # Check if locked out
        if key in self.locked_out:
            lockout_time = self.locked_out[key]
            if now < lockout_time:
                remaining = (lockout_time - now).seconds
                return False, f"🚫 Too many attempts. Try again in {remaining // 60} minutes."
            else:
                # Lockout expired
                del self.locked_out[key]

        # Clean old attempts (last hour only)
        cutoff_time = now - timedelta(hours=self.window_hours)
        self.attempts[key] = [
            attempt for attempt in self.attempts[key] if attempt > cutoff_time]

        # Check current attempts
        if len(self.attempts[key]) >= self.max_attempts:
            # Apply lockout
            self.locked_out[key] = now + \
                timedelta(seconds=self.lockout_duration)
            return False, f"🚫 Account locked for {self.lockout_duration // 60} minutes due to too many attempts."

        # Record this attempt
        self.attempts[key].append(now)
        return True, None

    def get_attempts_count(self, identifier: str, operation: str = "default") -> int:
        """Get number of attempts in current window"""
        key = f"{identifier}:{operation}"
        cutoff_time = datetime.now() - timedelta(hours=self.window_hours)
        self.attempts[key] = [
            attempt for attempt in self.attempts[key] if attempt > cutoff_time]
        return len(self.attempts[key])

    def reset_attempts(self, identifier: str, operation: str = "default"):
        """Reset attempts for identifier (on success)"""
        key = f"{identifier}:{operation}"
        if key in self.attempts:
            del self.attempts[key]
        if key in self.locked_out:
            del self.locked_out[key]

    def cleanup_expired(self):
        """Clean up expired entries"""
        now = datetime.now()

        # Clean locked_out
        expired_lockouts = [k for k, v in self.locked_out.items() if now >= v]
        for key in expired_lockouts:
            del self.locked_out[key]

        # Clean attempts (keep 2 hours history max)
        cutoff_time = now - timedelta(hours=2)
        for key in list(self.attempts.keys()):
            self.attempts[key] = [
                attempt for attempt in self.attempts[key] if attempt > cutoff_time]
            if not self.attempts[key]:
                del self.attempts[key]


# Global instance
rate_limiter = RateLimiter()
