import * as path from 'path'
import { Injectable } from '@angular/core'
import { ElectronService, WIN_BUILD_CONPTY_SUPPORTED, isWindowsBuild } from 'terminus-core'
import { SessionOptions } from '../api/interfaces'

/** @hidden */
@Injectable({ providedIn: 'root' })
export class UACService {
    isAvailable = false

    private constructor (
        private electron: ElectronService,
    ) {
        this.isAvailable = isWindowsBuild(WIN_BUILD_CONPTY_SUPPORTED)
    }

    patchSessionOptionsForUAC (sessionOptions: SessionOptions): SessionOptions {
        let helperPath = path.join(
            path.dirname(this.electron.app.getPath('exe')),
            'resources',
            'extras',
            'UAC.exe',
        )

        if (process.env.TERMINUS_DEV) {
            helperPath = path.join(
                path.dirname(this.electron.app.getPath('exe')),
                '..', '..', '..',
                'extras',
                'UAC.exe',
            )
        }

        const options = { ...sessionOptions }
        options.args = [options.command, ...options.args ?? []]
        options.command = helperPath
        return options
    }

}
