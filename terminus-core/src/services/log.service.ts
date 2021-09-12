import { Injectable } from '@angular/core'
import { ElectronService } from './electron.service'
import type * as winston from 'winston'
import * as fs from 'fs'
import * as path from 'path'

const initializeWinston = (electron: ElectronService) => {
    const logDirectory = electron.app.getPath('userData')
    // eslint-disable-next-line
    const winston = require('winston')

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
        private winstonLogger: winston.Logger,
        private name: string,
    ) {}

    debug (...args: any[]): void {
        this.doLog('debug', ...args)
    }

    info (...args: any[]): void {
        this.doLog('info', ...args)
    }

    warn (...args: any[]): void {
        this.doLog('warn', ...args)
    }

    error (...args: any[]): void {
        this.doLog('error', ...args)
    }

    log (...args: any[]): void {
        this.doLog('log', ...args)
    }

    private doLog (level: string, ...args: any[]): void {
        console[level](`%c[${this.name}]`, 'color: #aaa', ...args)
        this.winstonLogger[level](...args)
    }
}

@Injectable({ providedIn: 'root' })
export class LogService {
    private log: winston.Logger

    /** @hidden */
    private constructor (electron: ElectronService) {
        if (!process.env.XWEB) {
            this.log = initializeWinston(electron)
        } else {
            this.log = console as any
        }
    }

    create (name: string): Logger {
        return new Logger(this.log, name)
    }
}
