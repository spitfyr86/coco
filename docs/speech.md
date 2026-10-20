# Speech output

Windows speech is the default. In **Settings → Voice → Speech provider**, choose **Windows** for local synthesis with no speech API charge, or explicitly choose **OpenAI** for natural speech. **Read responses aloud** controls automatic replies; the response speaker button still works on demand. Turning automatic speech off does not disable that manual action. Microphone recognition remains local Windows speech in either mode.

OpenAI uses `gpt-4o-mini-tts`, the same securely stored OpenAI key as coaching, a voice dropdown, and 0.75×/1×/1.25× speed. It works with an Ollama coaching model too. The shared key is managed in Settings → API key. Preview is an explicit synthesis request using the current unsaved voice choices; Cancel does not undo a preview request or its API charge. Selecting a provider/voice alone makes no speech API request. Windows remains selected for existing settings files until you change it.

OpenAI previews and generated replies have additional usage charges. Spoken text is sent to OpenAI and is subject to its API data policies; it can contain sensitive conversation details. Common credential patterns are redacted. Automatic spoken guidance is capped at 900 characters, while the full reply stays in chat; manual replay is capped at 3,500 characters. The speech service receives only the spoken text and delivery instructions, not a separate screenshot/repository upload. Audio stays in memory and is played by a fixed Windows helper; it is not written to session history or disk. Speech has a 45-second HTTP timeout and an 8 MiB audio limit. Errors appear in the UI; there is no automatic switch to a paid voice or silent provider fallback.

**Stop speech**, switching tabs, starting the microphone, or exiting cancels pending speech and stops playback. Cancelling a request cannot guarantee that OpenAI has not already generated billable audio. Playback must be explicitly requested again; unfinished speech is not resumed after restart. Preview also has its own Stop control, and closing Settings stops the preview.

This adds natural text-to-speech output, not an always-listening Realtime conversation. The spoken voice is AI-generated. Realtime turn-taking, microphone streaming to OpenAI, and automatic voice activity detection are outside this change.

API contract: [Create speech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create). Availability and actual naturalness depend on the live provider/account and audio device; local fixtures do not establish them.

