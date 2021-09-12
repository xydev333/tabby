import colors from 'ansi-colors'
import stripAnsi from 'strip-ansi'
import { open as openTemp } from 'temp'
import { Injectable, NgZone } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { Client } from 'ssh2'
import { SSH2Stream } from 'ssh2-streams'
import * as fs from 'mz/fs'
import { execFile } from 'mz/child_process'
import * as path from 'path'
import * as sshpk from 'sshpk'
import { HostAppService, Platform, Logger, LogService, ElectronService, AppService, SelectorOption, ConfigService, NotificationsService } from 'terminus-core'
import { SettingsTabComponent } from 'terminus-settings'
import { ALGORITHM_BLACKLIST, SSHConnection, SSHSession } from '../api'
import { PromptModalComponent } from '../components/promptModal.component'
import { PasswordStorageService } from './passwordStorage.service'
import { SSHTabComponent } from '../components/sshTab.component'

const WINDOWS_OPENSSH_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent'

try {
    var windowsProcessTreeNative = require('windows-process-tree/build/Release/windows_process_tree.node') // eslint-disable-line @typescript-eslint/no-var-requires, no-var
} catch { }


// eslint-disable-next-line @typescript-eslint/no-type-alias
export type SSHLogCallback = (message: string) => void


@Injectable({ providedIn: 'root' })
export class SSHService {
    private logger: Logger

    private constructor (
        private log: LogService,
        private electron: ElectronService,
        private zone: NgZone,
        private ngbModal: NgbModal,
        private hostApp: HostAppService,
        private passwordStorage: PasswordStorageService,
        private notifications: NotificationsService,
        private app: AppService,
        private config: ConfigService,
    ) {
        this.logger = log.create('ssh')
    }

    createSession (connection: SSHConnection): SSHSession {
        const session = new SSHSession(connection)
        session.logger = this.log.create(`ssh-${connection.host}-${connection.port}`)
        return session
    }

    async loadPrivateKeyForSession (session: SSHSession, logCallback?: SSHLogCallback): Promise<string|null> {
        let privateKey: string|null = null
        let privateKeyPath = session.connection.privateKey

        if (!privateKeyPath) {
            const userKeyPath = path.join(process.env.HOME!, '.ssh', 'id_rsa')
            if (await fs.exists(userKeyPath)) {
                logCallback?.('Using user\'s default private key')
                privateKeyPath = userKeyPath
            }
        }

        if (privateKeyPath) {
            logCallback?.('Loading private key from ' + colors.bgWhite.blackBright(' ' + privateKeyPath + ' '))
            try {
                privateKey = (await fs.readFile(privateKeyPath)).toString()
            } catch (error) {
                logCallback?.(colors.bgRed.black(' X ') + 'Could not read the private key file')
                this.notifications.error('Could not read the private key file')
            }

            if (privateKey) {
                let parsedKey: any = null
                try {
                    parsedKey = sshpk.parsePrivateKey(privateKey, 'auto')
                } catch (e) {
                    if (e instanceof sshpk.KeyEncryptedError) {
                        const modal = this.ngbModal.open(PromptModalComponent)
                        logCallback?.(colors.bgYellow.yellow.black(' ! ') + ' Key requires passphrase')
                        modal.componentInstance.prompt = 'Private key passphrase'
                        modal.componentInstance.password = true
                        let passphrase = ''
                        try {
                            const result  = await modal.result
                            passphrase = result?.value
                        } catch { }
                        parsedKey = sshpk.parsePrivateKey(
                            privateKey,
                            'auto',
                            { passphrase: passphrase }
                        )
                    } else {
                        throw e
                    }
                }

                const sshFormatKey = parsedKey.toString('openssh')
                const temp = await openTemp()
                fs.close(temp.fd)
                await fs.writeFile(temp.path, sshFormatKey)

                let sshKeygenPath = 'ssh-keygen'
                if (this.hostApp.platform === Platform.Windows) {
                    sshKeygenPath = path.join(
                        path.dirname(this.electron.app.getPath('exe')),
                        'resources',
                        'extras',
                        'ssh-keygen',
                        'ssh-keygen.exe',
                    )
                    await execFile('icacls', [temp.path, '/inheritance:r'])
                    let sid = await execFile('whoami', ['/user', '/nh', '/fo', 'csv'])
                    sid = sid[0].split(',')[0]
                    sid = sid.substring(1, sid.length - 1)
                    await execFile('icacls', [temp.path, '/grant:r', `${sid}:(R,W)`])
                }

                await execFile(sshKeygenPath, [
                    '-p', '-P', '', '-N', '', '-m', 'PEM', '-f',
                    temp.path,
                ])

                privateKey = await fs.readFile(temp.path, { encoding: 'utf-8' })
                fs.unlink(temp.path)
            }
        }
        return privateKey
    }

    async connectSession (session: SSHSession, logCallback?: SSHLogCallback): Promise<void> {
        if (!logCallback) {
            logCallback = () => null
        }

        const log = (s: any) => {
            logCallback!(s)
            this.logger.info(stripAnsi(s))
        }

        let privateKey: string|null = null

        const ssh = new Client()
        session.ssh = ssh
        let connected = false
        let savedPassword: string|null = null
        const algorithms = {}
        for (const key of Object.keys(session.connection.algorithms ?? {})) {
            algorithms[key] = session.connection.algorithms![key].filter(x => !ALGORITHM_BLACKLIST.includes(x))
        }
        await new Promise(async (resolve, reject) => {
            ssh.on('ready', () => {
                connected = true
                if (savedPassword) {
                    this.passwordStorage.savePassword(session.connection, savedPassword)
                }
                this.zone.run(resolve)
            })
            ssh.on('error', error => {
                if (error.message === 'All configured authentication methods failed') {
                    this.passwordStorage.deletePassword(session.connection)
                }
                this.zone.run(() => {
                    if (connected) {
                        // eslint-disable-next-line @typescript-eslint/no-base-to-string
                        this.notifications.error(error.toString())
                    } else {
                        reject(error)
                    }
                })
            })
            ssh.on('close', () => {
                if (session.open) {
                    session.destroy()
                }
            })

            ssh.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => this.zone.run(async () => {
                log(colors.bgBlackBright(' ') + ` Keyboard-interactive auth requested: ${name}`)
                this.logger.info('Keyboard-interactive auth:', name, instructions, instructionsLang)
                const results: string[] = []
                for (const prompt of prompts) {
                    const modal = this.ngbModal.open(PromptModalComponent)
                    modal.componentInstance.prompt = prompt.prompt
                    modal.componentInstance.password = !prompt.echo

                    try {
                        const result = await modal.result
                        results.push(result ? result.value : '')
                    } catch {
                        results.push('')
                    }
                }
                finish(results)
            }))

            ssh.on('greeting', greeting => {
                if (!session.connection.skipBanner) {
                    log('Greeting: ' + greeting)
                }
            })

            ssh.on('banner', banner => {
                if (!session.connection.skipBanner) {
                    log(banner)
                }
            })

            let agent: string|null = null
            if (this.hostApp.platform === Platform.Windows) {
                if (await fs.exists(WINDOWS_OPENSSH_AGENT_PIPE)) {
                    agent = WINDOWS_OPENSSH_AGENT_PIPE
                } else {
                    // eslint-disable-next-line @typescript-eslint/no-shadow
                    const pageantRunning = await new Promise<boolean>(resolve => {
                        windowsProcessTreeNative.getProcessList(list => { // eslint-disable-line block-scoped-var
                            resolve(list.some(x => x.name === 'pageant.exe'))
                        }, 0)
                    })
                    if (pageantRunning) {
                        agent = 'pageant'
                    }
                }
            } else {
                agent = process.env.SSH_AUTH_SOCK!
            }

            const authMethodsLeft = ['none']
            if (!session.connection.auth || session.connection.auth === 'publicKey') {
                privateKey = await this.loadPrivateKeyForSession(session, log)
                if (!privateKey) {
                    log('\r\nPrivate key auth selected, but no key is loaded\r\n')
                } else {
                    authMethodsLeft.push('publickey')
                }
            }
            if (!session.connection.auth || session.connection.auth === 'agent') {
                if (!agent) {
                    log('\r\nAgent auth selected, but no running agent is detected\r\n')
                } else {
                    authMethodsLeft.push('agent')
                }
            }
            if (!session.connection.auth || session.connection.auth === 'password') {
                authMethodsLeft.push('password')
            }
            if (!session.connection.auth || session.connection.auth === 'keyboardInteractive') {
                authMethodsLeft.push('keyboard-interactive')
            }
            authMethodsLeft.push('hostbased')

            try {
                ssh.connect({
                    host: session.connection.host,
                    port: session.connection.port ?? 22,
                    username: session.connection.user,
                    password: session.connection.privateKey ? undefined : '',
                    privateKey: privateKey ?? undefined,
                    tryKeyboard: true,
                    agent: agent ?? undefined,
                    agentForward: session.connection.agentForward && !!agent,
                    keepaliveInterval: session.connection.keepaliveInterval ?? 15000,
                    keepaliveCountMax: session.connection.keepaliveCountMax,
                    readyTimeout: session.connection.readyTimeout,
                    hostVerifier: (digest: string) => {
                        log(colors.bgWhite(' ') + ' Host key fingerprint:')
                        log(colors.bgWhite(' ') + ' ' + colors.black.bgWhite(' SHA256 ') + colors.bgBlackBright(' ' + digest + ' '))
                        return true
                    },
                    hostHash: 'sha256' as any,
                    algorithms,
                    sock: session.jumpStream,
                    authHandler: methodsLeft => {
                        while (true) {
                            const method = authMethodsLeft.shift()
                            if (!method) {
                                return false
                            }
                            if (methodsLeft && !methodsLeft.includes(method) && method !== 'agent') {
                                // Agent can still be used even if not in methodsLeft
                                this.logger.info('Server does not support auth method', method)
                                continue
                            }
                            return method
                        }
                    },
                } as any)
            } catch (e) {
                this.notifications.error(e.message)
                return reject(e)
            }

            let keychainPasswordUsed = false

            ;(ssh as any).config.password = () => this.zone.run(async () => {
                if (session.connection.password) {
                    log('Using preset password')
                    return session.connection.password
                }

                if (!keychainPasswordUsed) {
                    const password = await this.passwordStorage.loadPassword(session.connection)
                    if (password) {
                        log('Trying saved password')
                        keychainPasswordUsed = true
                        return password
                    }
                }

                const modal = this.ngbModal.open(PromptModalComponent)
                modal.componentInstance.prompt = `Password for ${session.connection.user}@${session.connection.host}`
                modal.componentInstance.password = true
                modal.componentInstance.showRememberCheckbox = true
                try {
                    const result = await modal.result
                    if (result) {
                        if (result.remember) {
                            savedPassword = result.value
                        }
                        return result.value
                    }
                    return ''
                } catch (_) {
                    return ''
                }
            })
        })
    }

    async showConnectionSelector (): Promise<void> {
        const options: SelectorOption<void>[] = []
        const recentConnections = this.config.store.ssh.recentConnections

        for (const connection of recentConnections) {
            options.push({
                name: connection.name,
                description: connection.host,
                icon: 'history',
                callback: () => this.connect(connection),
            })
        }

        if (recentConnections.length) {
            options.push({
                name: 'Clear recent connections',
                icon: 'eraser',
                callback: () => {
                    this.config.store.ssh.recentConnections = []
                    this.config.save()
                },
            })
        }

        const groups: { name: string, connections: SSHConnection[] }[] = []
        const connections = this.config.store.ssh.connections
        for (const connection of connections) {
            connection.group = connection.group || null
            let group = groups.find(x => x.name === connection.group)
            if (!group) {
                group = {
                    name: connection.group!,
                    connections: [],
                }
                groups.push(group)
            }
            group.connections.push(connection)
        }

        for (const group of groups) {
            for (const connection of group.connections) {
                options.push({
                    name: (group.name ? `${group.name} / ` : '') + connection.name,
                    description: connection.host,
                    icon: 'desktop',
                    callback: () => this.connect(connection),
                })
            }
        }

        options.push({
            name: 'Manage connections',
            icon: 'cog',
            callback: () => this.app.openNewTabRaw(SettingsTabComponent, { activeTab: 'ssh' }),
        })

        options.push({
            name: 'Quick connect',
            freeInputPattern: 'Connect to "%s"...',
            icon: 'arrow-right',
            callback: query => this.quickConnect(query),
        })


        await this.app.showSelector('Open an SSH connection', options)
    }

    async connect (connection: SSHConnection): Promise<SSHTabComponent> {
        try {
            const tab = this.app.openNewTab(
                SSHTabComponent,
                { connection }
            ) as SSHTabComponent
            if (connection.color) {
                (this.app.getParentTab(tab) ?? tab).color = connection.color
            }

            setTimeout(() => this.app.activeTab?.emitFocused())

            return tab
        } catch (error) {
            this.notifications.error(`Could not connect: ${error}`)
            throw error
        }
    }

    quickConnect (query: string): Promise<SSHTabComponent> {
        let user = 'root'
        let host = query
        let port = 22
        if (host.includes('@')) {
            const parts = host.split(/@/g)
            host = parts[parts.length - 1]
            user = parts.slice(0, parts.length - 1).join('@')
        }
        if (host.includes(':')) {
            port = parseInt(host.split(':')[1])
            host = host.split(':')[0]
        }

        const connection: SSHConnection = {
            name: query,
            group: null,
            host,
            user,
            port,
        }

        const recentConnections = this.config.store.ssh.recentConnections
        recentConnections.unshift(connection)
        if (recentConnections.length > 5) {
            recentConnections.pop()
        }
        this.config.store.ssh.recentConnections = recentConnections
        this.config.save()
        return this.connect(connection)
    }
}

/* eslint-disable */
const _authPassword = SSH2Stream.prototype.authPassword
SSH2Stream.prototype.authPassword = async function (username, passwordFn: any) {
    _authPassword.bind(this)(username, await passwordFn())
} as any
