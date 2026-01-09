export function getStreakRewardPoints(streakDay: number): number {
  const milestones: Record<number, number> = {
    5: 2,
    10: 3,
    15: 4,
    20: 5,
    25: 6,
    30: 10
  };
  return milestones[streakDay] || 1;
}

export function formatTimeRemaining(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const countdown: string[] = [];
  if (hours > 0) {
    countdown.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  }
  if (minutes > 0) {
    countdown.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  }
  if (seconds > 0 || (hours === 0 && minutes === 0)) {
    countdown.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
  }
  return countdown.join(', ');
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]; // YYYY-MM-DD format
}