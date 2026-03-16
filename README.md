
Build info
- CJS support for typescript on main process
  - using 
- ESM support for writing render process in ts
  - uses esbuild

Dev Info
- bootstrap script was needed because race condition was having tsx/cjs fail when using `electron` command


Testing livekit streaming
- homebrew livekit-cli
- auth into cli with livekit cloud account
- create 3 tokens: one for render process, one for main process, and one for browser login to Meets App (https://meet.livekit.io/)
  - lk token create --join --room test_room --identity browser --valid-for 24h
- paste server url and access tokens into `src/config.ts`