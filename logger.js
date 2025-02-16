import chalk from 'chalk';

class Logger {
    constructor(component) {
        this.component = component;
    }

    _formatMessage(level, ...args) {
        const timestamp = new Date().toISOString();
        const componentStr = this.component ? `[${this.component}]` : '';
        return `${timestamp} ${level}${componentStr} ${args.join(' ')}`;
    }

    info(...args) {
        console.log(chalk.blue(this._formatMessage('INFO', ...args)));
    }

    success(...args) {
        console.log(chalk.green(this._formatMessage('SUCCESS', ...args)));
    }

    warn(...args) {
        console.log(chalk.yellow(this._formatMessage('WARN', ...args)));
    }

    error(...args) {
        console.error(chalk.red(this._formatMessage('ERROR', ...args)));
    }

    debug(...args) {
        if (process.env.DEBUG) {
            console.log(chalk.gray(this._formatMessage('DEBUG', ...args)));
        }
    }
}

export default function createLogger(component) {
    return new Logger(component);
}; 