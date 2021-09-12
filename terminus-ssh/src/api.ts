import colors from 'ansi-colors'
import stripAnsi from 'strip-ansi'
import socksv5 from 'socksv5'
import { BaseSession } from 'terminus-terminal'
import { Server, Socket, createServer, createConnection } from 'net'
import { Client, ClientChannel } from 'ssh2'
import { Logger } from 'terminus-core'
import { Subject, Observable } from 'rxjs'

export interface LoginScript {
    expect: string
    send: string
    isRegex?: boolean
    optional?: boolean
}

export enum SSHAlgorithmType {
    HMAC = 'hmac',
    KEX = 'kex',
    CIPHER = 'cipher',
    HOSTKEY = 'serverHostKey',
}

export interface SSHConnection {
    name: string
    host: string
    port?: number
    user: string
    auth?: null|'password'|'publicKey'|'agent'|'keyboardInteractive'
    password?: string
    privateKey?: string
    group: string | null
    scripts?: LoginScript[]
    keepaliveInterval?: number
    keepaliveCountMax?: number
    readyTimeout?: number
    color?: string
    x11?: boolean
    skipBanner?: boolean
    disableDynamicTitle?: boolean
    jumpHost?: string
    agentForward?: boolean
    warnOnClose?: boolean
    algorithms?: Record<string, string[]>
}

export enum PortForwardType {
    Local = 'Local',
    Remote = 'Remote',
    Dynamic = 'Dynamic',
}

export class ForwardedPort {
    type: PortForwardType
    host = '127.0.0.1'
    port: number
    targetAddress: string
    targetPort: number

    private listener: Server

    async startLocalListener (callback: (accept: () => Socket, reject: () => void, sourceAddress: string|null, sourcePort: number|null, targetAddress: string, targetPort: number) => void): Promise<void> {
        if (this.type === PortForwardType.Local) {
            this.listener = createServer(s => callback(
                () => s,
                () => s.destroy(),
                s.remoteAddress ?? null,
                s.remotePort ?? null,
                this.targetAddress,
                this.targetPort,
            ))
            return new Promise((resolve, reject) => {
                this.listener.listen(this.port, this.host)
                this.listener.on('error', reject)
                this.listener.on('listening', resolve)
            })
        } else if (this.type === PortForwardType.Dynamic) {
            return new Promise((resolve, reject) => {
                this.listener = socksv5.createServer((info, acceptConnection, rejectConnection) => {
                    callback(
                        () => acceptConnection(true),
                        () => rejectConnection(),
                        null,
                        null,
                        info.dstAddr,
                        info.dstPort,
                    )
                })
                this.listener.on('error', reject)
                this.listener.listen(this.port, this.host, resolve)
                ;(this.listener as any).useAuth(socksv5.auth.None())
            })
        } else {
            throw new Error('Invalid forward type for a local listener')
        }
    }

    stopLocalListener (): void {
        this.listener.close()
    }

    toString (): string {
        if (this.type === PortForwardType.Local) {
            return `(local) ${this.host}:${this.port} → (remote) ${this.targetAddress}:${this.targetPort}`
        } if (this.type === PortForwardType.Remote) {
            return `(remote) ${this.host}:${this.port} → (local) ${this.targetAddress}:${this.targetPort}`
        } else {
            return `(dynamic) ${this.host}:${this.port}`
        }
    }
}

export class SSHSession extends BaseSession {
    scripts?: LoginScript[]
    shell?: ClientChannel
    ssh: Client
    forwardedPorts: ForwardedPort[] = []
    logger: Logger
    jumpStream: any

    get serviceMessage$ (): Observable<string> { return this.serviceMessage }
    private serviceMessage = new Subject<string>()

    constructor (public connection: SSHConnection) {
        super()
        this.scripts = connection.scripts ?? []
        this.destroyed$.subscribe(() => {
            for (const port of this.forwardedPorts) {
                if (port.type === PortForwardType.Local) {
                    port.stopLocalListener()
                }
            }
        })
    }

    async start (): Promise<void> {
        this.open = true

        try {
            this.shell = await this.openShellChannel({ x11: this.connection.x11 })
        } catch (err) {
            this.emitServiceMessage(colors.bgRed.black(' X ') + ` Remote rejected opening a shell channel: ${err}`)
            if (err.toString().includes('Unable to request X11')) {
                this.emitServiceMessage('    Make sure `xauth` is installed on the remote side')
            }
            return
        }

        this.shell.on('greeting', greeting => {
            this.emitServiceMessage(`Shell greeting: ${greeting}`)
        })

        this.shell.on('banner', banner => {
            this.emitServiceMessage(`Shell banner: ${banner}`)
        })

        this.shell.on('data', data => {
            const dataString = data.toString()
            this.emitOutput(data)

            if (this.scripts) {
                let found = false
                for (const script of this.scripts) {
                    let match = false
                    let cmd = ''
                    if (script.isRegex) {
                        const re = new RegExp(script.expect, 'g')
                        if (dataString.match(re)) {
                            cmd = dataString.replace(re, script.send)
                            match = true
                            found = true
                        }
                    } else {
                        if (dataString.includes(script.expect)) {
                            cmd = script.send
                            match = true
                            found = true
                        }
                    }

                    if (match) {
                        this.logger.info('Executing script: "' + cmd + '"')
                        this.shell!.write(cmd + '\n')
                        this.scripts = this.scripts.filter(x => x !== script)
                    } else {
                        if (script.optional) {
                            this.logger.debug('Skip optional script: ' + script.expect)
                            found = true
                            this.scripts = this.scripts.filter(x => x !== script)
                        } else {
                            break
                        }
                    }
                }

                if (found) {
                    this.executeUnconditionalScripts()
                }
            }
        })

        this.shell.on('end', () => {
            this.logger.info('Shell session ended')
            if (this.open) {
                this.destroy()
            }
        })

        this.ssh.on('tcp connection', (details, accept, reject) => {
            this.logger.info(`Incoming forwarded connection: (remote) ${details.srcIP}:${details.srcPort} -> (local) ${details.destIP}:${details.destPort}`)
            const forward = this.forwardedPorts.find(x => x.port === details.destPort)
            if (!forward) {
                this.emitServiceMessage(colors.bgRed.black(' X ') + ` Rejected incoming forwarded connection for unrecognized port ${details.destPort}`)
                return reject()
            }
            const socket = new Socket()
            socket.connect(forward.targetPort, forward.targetAddress)
            socket.on('error', e => {
                // eslint-disable-next-line @typescript-eslint/no-base-to-string
                this.emitServiceMessage(colors.bgRed.black(' X ') + ` Could not forward the remote connection to ${forward.targetAddress}:${forward.targetPort}: ${e}`)
                reject()
            })
            socket.on('connect', () => {
                this.logger.info('Connection forwarded')
                const stream = accept()
                stream.pipe(socket)
                socket.pipe(stream)
                stream.on('close', () => {
                    socket.destroy()
                })
                socket.on('close', () => {
                    stream.close()
                })
            })
        })

        this.ssh.on('x11', (details, accept, reject) => {
            this.logger.info(`Incoming X11 connection from ${details.srcIP}:${details.srcPort}`)
            const displaySpec = process.env.DISPLAY ?? ':0'
            this.logger.debug(`Trying display ${displaySpec}`)
            const xHost = displaySpec.split(':')[0]
            const xDisplay = parseInt(displaySpec.split(':')[1].split('.')[0] || '0')
            const xPort = xDisplay < 100 ? xDisplay + 6000 : xDisplay

            const socket = displaySpec.startsWith('/') ? createConnection(displaySpec) : new Socket()
            if (!displaySpec.startsWith('/')) {
                socket.connect(xPort, xHost)
            }
            socket.on('error', e => {
                // eslint-disable-next-line @typescript-eslint/no-base-to-string
                this.emitServiceMessage(colors.bgRed.black(' X ') + ` Could not connect to the X server: ${e}`)
                this.emitServiceMessage(`    Terminus tried to connect to ${xHost}:${xPort} based on the DISPLAY environment var (${displaySpec})`)
                if (process.platform === 'win32') {
                    this.emitServiceMessage('    To use X forwarding, you need a local X server, e.g.:')
                    this.emitServiceMessage('    * VcXsrv: https://sourceforge.net/projects/vcxsrv/')
                    this.emitServiceMessage('    * Xming: https://sourceforge.net/projects/xming/')
                }
                reject()
            })
            socket.on('connect', () => {
                this.logger.info('Connection forwarded')
                const stream = accept()
                stream.pipe(socket)
                socket.pipe(stream)
                stream.on('close', () => {
                    socket.destroy()
                })
                socket.on('close', () => {
                    stream.close()
                })
            })
        })

        this.executeUnconditionalScripts()
    }

    emitServiceMessage (msg: string): void {
        this.serviceMessage.next(msg)
        this.logger.info(stripAnsi(msg))
    }

    async addPortForward (fw: ForwardedPort): Promise<void> {
        if (fw.type === PortForwardType.Local || fw.type === PortForwardType.Dynamic) {
            await fw.startLocalListener((accept, reject, sourceAddress, sourcePort, targetAddress, targetPort) => {
                this.logger.info(`New connection on ${fw}`)
                this.ssh.forwardOut(
                    sourceAddress ?? '127.0.0.1',
                    sourcePort ?? 0,
                    targetAddress,
                    targetPort,
                    (err, stream) => {
                        if (err) {
                            // eslint-disable-next-line @typescript-eslint/no-base-to-string
                            this.emitServiceMessage(colors.bgRed.black(' X ') + ` Remote has rejected the forwarded connection to ${targetAddress}:${targetPort} via ${fw}: ${err}`)
                            return reject()
                        }
                        const socket = accept()
                        stream.pipe(socket)
                        socket.pipe(stream)
                        stream.on('close', () => {
                            socket.destroy()
                        })
                        socket.on('close', () => {
                            stream.close()
                        })
                    }
                )
            }).then(() => {
                this.emitServiceMessage(colors.bgGreen.black(' -> ') + ` Forwarded ${fw}`)
                this.forwardedPorts.push(fw)
            }).catch(e => {
                this.emitServiceMessage(colors.bgRed.black(' X ') + ` Failed to forward port ${fw}: ${e}`)
                throw e
            })
        }
        if (fw.type === PortForwardType.Remote) {
            await new Promise((resolve, reject) => {
                this.ssh.forwardIn(fw.host, fw.port, err => {
                    if (err) {
                        // eslint-disable-next-line @typescript-eslint/no-base-to-string
                        this.emitServiceMessage(colors.bgRed.black(' X ') + ` Remote rejected port forwarding for ${fw}: ${err}`)
                        return reject(err)
                    }
                    resolve()
                })
            })
            this.emitServiceMessage(colors.bgGreen.black(' <- ') + ` Forwarded ${fw}`)
            this.forwardedPorts.push(fw)
        }
    }

    async removePortForward (fw: ForwardedPort): Promise<void> {
        if (fw.type === PortForwardType.Local || fw.type === PortForwardType.Dynamic) {
            fw.stopLocalListener()
            this.forwardedPorts = this.forwardedPorts.filter(x => x !== fw)
        }
        if (fw.type === PortForwardType.Remote) {
            this.ssh.unforwardIn(fw.host, fw.port)
            this.forwardedPorts = this.forwardedPorts.filter(x => x !== fw)
        }
        this.emitServiceMessage(`Stopped forwarding ${fw}`)
    }

    resize (columns: number, rows: number): void {
        if (this.shell) {
            this.shell.setWindow(rows, columns, rows, columns)
        }
    }

    write (data: Buffer): void {
        if (this.shell) {
            this.shell.write(data)
        }
    }

    kill (signal?: string): void {
        if (this.shell) {
            this.shell.signal(signal ?? 'TERM')
        }
    }

    async destroy (): Promise<void> {
        this.serviceMessage.complete()
        await super.destroy()
    }

    async getChildProcesses (): Promise<any[]> {
        return []
    }

    async gracefullyKillProcess (): Promise<void> {
        this.kill('TERM')
    }

    supportsWorkingDirectory (): boolean {
        return true
    }

    async getWorkingDirectory (): Promise<string|null> {
        return null
    }

    private openShellChannel (options): Promise<ClientChannel> {
        return new Promise<ClientChannel>((resolve, reject) => {
            this.ssh.shell({ term: 'xterm-256color' }, options, (err, shell) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(shell)
                }
            })
        })
    }

    private executeUnconditionalScripts () {
        if (this.scripts) {
            for (const script of this.scripts) {
                if (!script.expect) {
                    console.log('Executing script:', script.send)
                    this.shell!.write(script.send + '\n')
                    this.scripts = this.scripts.filter(x => x !== script)
                } else {
                    break
                }
            }
        }
    }
}

export interface SSHConnectionGroup {
    name: string
    connections: SSHConnection[]
}

export const ALGORITHM_BLACKLIST = [
    // cause native crashes in node crypto, use EC instead
    'diffie-hellman-group-exchange-sha256',
    'diffie-hellman-group-exchange-sha1',
]
