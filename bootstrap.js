const { execSync } = require('child_process')

// Compile render.ts to js before starting
execSync('tsc -p tsconfig.json --noEmitOnError false', { stdio: 'inherit' })
execSync('npx esbuild renderer/render.ts --bundle --outfile=out/render.js --platform=browser', { stdio: 'inherit' })

require('tsx/cjs')
require('./src/main.ts')