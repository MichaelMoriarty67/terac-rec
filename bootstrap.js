const { execSync } = require('child_process')

// Compile render.ts to js before starting
execSync('tsc -p tsconfig.json --noEmitOnError false', { stdio: 'inherit' })
execSync('npx tsc -p renderer/tsconfig.json --noEmitOnError false', { stdio: 'inherit' })

require('tsx/cjs')
require('./src/main.ts')