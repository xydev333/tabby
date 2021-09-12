// See: https://medium.com/@TwitterArchiveEraser/notarize-electron-apps-7a5f988406db

const fs = require('fs')
const path = require('path')
const notarizer = require('electron-notarize')

module.exports = async function (params) {
    // notarize the app on Mac OS only.
    if (process.platform !== 'darwin' || !process.env.GITHUB_REF || !process.env.GITHUB_REF.startsWith('refs/tags/')) {
        return
    }
    console.log('afterSign hook triggered', params)

    let appId = 'org.terminus'

    let appPath = path.join(params.appOutDir, params._pathOverride || `${params.packager.appInfo.productFilename}.app`)
    if (!fs.existsSync(appPath)) {
        throw new Error(`Cannot find application at: ${appPath}`)
    }

    console.log(`Notarizing ${appId} found at ${appPath}`)

    try {
        await notarizer.notarize({
            appBundleId: appId,
            appPath: appPath,
            appleId: process.env.APPSTORE_USERNAME,
            appleIdPassword: process.env.APPSTORE_PASSWORD,
        })
    } catch (error) {
        console.error(error)
    }

    console.log(`Done notarizing ${appId}`)
}
