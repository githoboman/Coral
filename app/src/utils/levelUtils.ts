/**
 * Leveling System Utility
 * Formula: Total XP for Level L = 100 * (L-1)^2
 * XP needed for Level L -> L+1 = TotalXP(L+1) - TotalXP(L)
 * = 100*L^2 - 100*(L-1)^2 = 100 * (2L - 1)
 * Level 1: 0
 * Level 2: 100 (Step 100)
 * Level 3: 400 (Step 300)
 * Level 4: 900 (Step 500)
 * Level 5: 1600 (Step 700)
 */

export interface LevelData {
  level: number;
  currentXpInLevel: number;
  xpNeededForNextLevel: number;
  progressPercentage: number;
}

/**
 * Returns the TOTAL XP required to reach a specific level.
 */
export const getTotalXpForLevel = (level: number): number => {
  if (level <= 1) return 0;
  return 100 * Math.pow(level - 1, 2);
};

/**
 * Calculates current level based on total XP.
 */
export const calculateLevel = (totalXp: number): number => {
  if (totalXp <= 0) return 1;
  // Solving 100 * (L-1)^2 = XP for L
  // (L-1)^2 = XP / 100
  // L-1 = sqrt(XP / 100)
  // L = sqrt(XP / 100) + 1
  const level = Math.floor(Math.sqrt(totalXp / 100) + 1);
  return Math.max(1, level);
};

/**
 * Returns detailed level information including progress to next level.
 */
export const getLevelData = (totalXp: number): LevelData => {
  const currentLevel = calculateLevel(totalXp);
  const xpAtCurrentLevel = getTotalXpForLevel(currentLevel);
  const xpAtNextLevel = getTotalXpForLevel(currentLevel + 1);

  const currentXpInLevel = totalXp - xpAtCurrentLevel;
  const xpNeededInThisLevel = xpAtNextLevel - xpAtCurrentLevel;

  const progressPercentage = Math.min(100, Math.max(0, (currentXpInLevel / xpNeededInThisLevel) * 100));

  return {
    level: currentLevel,
    currentXpInLevel,
    xpNeededForNextLevel: xpNeededInThisLevel,
    progressPercentage
  };
};