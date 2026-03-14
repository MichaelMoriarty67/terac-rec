import os from 'os'
import path from 'path'

const recFallbackDir = path.join(os.homedir(), "Documents", "Terac", "Recordings")
const roomUrl = 'ws://localhost:7880'
const roomToken = 'token-here'

export { recFallbackDir, roomUrl, roomToken }