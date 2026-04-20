// ============================================================
// utils/logger.ts — Colored, timestamped console logger
// ============================================================

import chalk from "chalk";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function timestamp(): string {
  return new Date().toISOString();
}

// Replacer that converts BigInt to string so JSON.stringify never throws
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function safeStringify(obj: object): string {
  return JSON.stringify(obj, bigintReplacer, 2);
}

export const logger = {
  debug(message: string, context?: object) {
    if (!shouldLog("debug")) return;
    console.log(
      chalk.gray(`[${timestamp()}] [DEBUG]`),
      chalk.gray(message),
      context ? chalk.gray(safeStringify(context)) : "",
    );
  },

  info(message: string, context?: object) {
    if (!shouldLog("info")) return;
    console.log(
      chalk.blue(`[${timestamp()}] [INFO] `),
      message,
      context ? chalk.cyan(safeStringify(context)) : "",
    );
  },

  success(message: string, context?: object) {
    if (!shouldLog("info")) return;
    console.log(
      chalk.green(`[${timestamp()}] [✅   ] `),
      chalk.green(message),
      context ? chalk.green(safeStringify(context)) : "",
    );
  },

  warn(message: string, context?: object) {
    if (!shouldLog("warn")) return;
    console.warn(
      chalk.yellow(`[${timestamp()}] [WARN] `),
      chalk.yellow(message),
      context ? chalk.yellow(safeStringify(context)) : "",
    );
  },

  error(message: string, error?: unknown, context?: object) {
    if (!shouldLog("error")) return;
    console.error(chalk.red(`[${timestamp()}] [ERR ] `), chalk.red(message));
    if (error instanceof Error) {
      console.error(chalk.red("  └─ "), chalk.red(error.message));
      if (error.stack) {
        console.error(chalk.gray(error.stack));
      }
    }
    if (context) {
      console.error(chalk.red(safeStringify(context))); // ← was crashing here
    }
  },

  bridge(direction: string, amount: string, from: string, to: string) {
    console.log(
      chalk.magenta(`[${timestamp()}] [🌉   ]`),
      chalk.magenta(`${direction}: ${amount}`),
      chalk.gray(`from ${from} → to ${to}`),
    );
  },
};
