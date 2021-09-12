import { Injectable } from '@angular/core'
import { ElectronService } from './electron.service'
import * as winston from 'winston'
import * as fs from 'fs'
import * as path from 'path'

const initializeWinston = (electron: ElectronService) => {
    const logDirectory = electron.app.getPath('userData')

    if (!fs.existsSync(logDirectory)) {
        fs.mkdirSync(logDirectory)
    }

    return winston.createLogger({
        transports: [
            new winston.transports.File({
                level: 'debug',
                filename: path.join(logDirectory, 'log.txt'),
                format: winston.format.simple(),
                handleExceptions: false,
                maxsize: 5242880,
                maxFiles: 5,
            }),
        ],
        exitOnError: false,
    })
}

export class Logger {
    constructor (
        private winstonLogger: any,
        private name: string,
    ) {}

    debug (...args: any[]) {
        this.doLog('debug', ...args)
    }

    info (...args: any[]) {
        this.doLog('info', ...args)
    }

    warn (...args: any[]) {
        this.doLog('warn', ...args)
    }

    error (...args: any[]) {
        this.doLog('error', ...args)
    }

    log (...args: any[]) {
        this.doLog('log', ...args)
    }

    private doLog (level: string, ...args: any[]) {
        console[level](`%c[${this.name}]`, 'color: #aaa', ...args)
        if (this.winstonLogger) {
            this.winstonLogger[level](...args)
        }
    }
}

@Injectable({ providedIn: 'root' })
export class LogService {
    private log: any

    /** @hidden */
    constructor (electron: ElectronService) {
        this.log = initializeWinston(electron)
    }

    create (name: string): Logger {
        return new Logger(this.log, name)
    }
}
