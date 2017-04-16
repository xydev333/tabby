import { ConfigProvider } from 'terminus-core'


export class TerminalConfigProvider extends ConfigProvider {
    defaultConfigValues: any = {
        terminal: {
            font: 'monospace',
            fontSize: 14,
            bell: 'off',
            bracketedPaste: true,
            background: 'theme',
            shell: 'auto',
            colorScheme: {
                __nonStructural: true,
                foreground: null,
                background: null,
                cursor: null,
                colors: [],
            },
            customColorSchemes: []
        },
        hotkeys: {
            'new-tab': [
                ['Ctrl-A', 'C'],
                ['Ctrl-A', 'Ctrl-C'],
                'Ctrl-Shift-T',
            ]
        },
    }

    configStructure: any = {
        terminal: {
            colorScheme: {},
        },
        hotkeys: {},
    }
}
