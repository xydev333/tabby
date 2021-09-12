import { Injectable } from '@angular/core'


export class Logger {
    constructor(
        private name: string,
    ) {}

    log(level: string, ...args: any[]) {
        args.splice(0, 0, this.name + ':')
        console[level](...args)
    }

    debug(...args: any[]) { this.log('debug', ...args) }
    info(...args: any[]) { this.log('info', ...args) }
    warn(...args: any[]) { this.log('warn', ...args) }
    error(...args: any[]) { this.log('error', ...args) }
}

@Injectable()
export class LogService {
    create (name: string): Logger {
        return new Logger(name)
    }
}
