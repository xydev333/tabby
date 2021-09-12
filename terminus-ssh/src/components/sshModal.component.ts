/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, NgZone } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { ToastrService } from 'ngx-toastr'
import { ConfigService, AppService } from 'terminus-core'
import { SettingsTabComponent } from 'terminus-settings'
import { SSHConnection, SSHConnectionGroup } from '../api'
import { SSHTabComponent } from './sshTab.component'

/** @hidden */
@Component({
    template: require('./sshModal.component.pug'),
    styles: [require('./sshModal.component.scss')],
})
export class SSHModalComponent {
    connections: SSHConnection[]
    childFolders: SSHConnectionGroup[]
    quickTarget: string
    recentConnections: SSHConnection[]
    childGroups: SSHConnectionGroup[]
    groupCollapsed: {[id: string]: boolean} = {}

    constructor (
        public modalInstance: NgbActiveModal,
        private config: ConfigService,
        private app: AppService,
        private toastr: ToastrService,
        private zone: NgZone,
    ) { }

    ngOnInit () {
        this.connections = this.config.store.ssh.connections
        this.recentConnections = this.config.store.ssh.recentConnections
        this.refresh()
    }

    quickConnect () {
        let user = 'root'
        let host = this.quickTarget
        let port = 22
        if (host.includes('@')) {
            [user, host] = host.split('@')
        }
        if (host.includes(':')) {
            port = parseInt(host.split(':')[1])
            host = host.split(':')[0]
        }

        const connection: SSHConnection = {
            name: this.quickTarget,
            group: null,
            host,
            user,
            port,
        }
        this.recentConnections.unshift(connection)
        if (this.recentConnections.length > 5) {
            this.recentConnections.pop()
        }
        this.config.store.ssh.recentConnections = this.recentConnections
        this.config.save()
        this.connect(connection)
    }

    clearConnection (connection) {
        this.recentConnections = this.recentConnections.filter(function (el) {
            return el === connection
        })
        this.config.store.ssh.recentConnections = this.recentConnections
        this.config.save()
    }

    async connect (connection: SSHConnection) {
        this.close()

        try {
            const tab = this.zone.run(() => this.app.openNewTab(
                SSHTabComponent,
                { connection }
            ) as SSHTabComponent)
            if (connection.color) {
                (this.app.getParentTab(tab) || tab).color = connection.color
            }

            setTimeout(() => {
                this.app.activeTab?.emitFocused()
            })
        } catch (error) {
            this.toastr.error(`Could not connect: ${error}`)
        }
    }

    manageConnections () {
        this.close()
        this.app.openNewTab(SettingsTabComponent, { activeTab: 'ssh' })
    }

    close () {
        this.modalInstance.close()
    }

    refresh () {
        this.childGroups = []

        let connections = this.connections
        if (this.quickTarget) {
            connections = connections.filter((connection: SSHConnection) => (connection.name + connection.group!).toLowerCase().includes(this.quickTarget))
        }

        for (const connection of connections) {
            connection.group = connection.group || null
            let group = this.childGroups.find(x => x.name === connection.group)
            if (!group) {
                group = {
                    name: connection.group!,
                    connections: [],
                }
                this.childGroups.push(group!)
            }
            group.connections.push(connection)
        }
    }
}
