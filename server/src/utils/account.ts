// src/utils/account.ts

/**
 * Calculate total XP needed to reach a level
 * Formula: XP needed = 1000 * level^1.5
 */
export const getXpForLevel = (level: number): number => {
  if (level <= 1) {
    return 0;
  }
  return Math.floor(1000 * Math.pow(level, 1.5));
};

/**
 * Calculate level from XP and return level progression info
 * Returns [level, xp_for_current_level, xp_for_next_level]
 */
export const calculateLevelFromXp = (xp: number): [number, number, number] => {
  let level = 1;

  while (getXpForLevel(level + 1) <= xp) {
    level++;
  }

  const currentLevelXp = getXpForLevel(level);
  const nextLevelXp = getXpForLevel(level + 1);

  return [level, currentLevelXp, nextLevelXp];
};
