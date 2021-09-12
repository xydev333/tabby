import * as os from 'os'

export const WIN_BUILD_CONPTY_SUPPORTED = 17692
export const WIN_BUILD_CONPTY_STABLE = 18309
export const WIN_BUILD_WSL_EXE_DISTRO_FLAG = 17763

export function isWindowsBuild (build: number): boolean {
    return process.platform === 'win32' && parseFloat(os.release()) >= 10 && parseInt(os.release().split('.')[2]) >= build
}

export function getCSSFontFamily (fontList: string): string {
    let fonts = fontList.split(',').map(x => x.trim().replace(/"/g, ''))
    fonts.push('monospace-fallback')
    fonts.push('monospace')
    fonts = fonts.map(x => `"${x}"`)
    return fonts.join(', ')
}
