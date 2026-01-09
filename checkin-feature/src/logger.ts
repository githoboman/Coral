export class Logger {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  static getLogger(name: string): Logger {
    return new Logger(name);
  }

  debug(message: string, ...args: any[]): void {
    console.debug(`[${new Date().toISOString()}] [DEBUG] [${this.name}] ${message}`, ...args);
  }

  info(message: string, ...args: any[]): void {
    console.info(`[${new Date().toISOString()}] [INFO] [${this.name}] ${message}`, ...args);
  }

  error(message: string, error?: any): void {
    console.error(`[${new Date().toISOString()}] [ERROR] [${this.name}] ${message}`, error);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`[${new Date().toISOString()}] [WARN] [${this.name}] ${message}`, ...args);
  }
}