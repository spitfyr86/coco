# Choosing a coaching model

CoCo needs text input/output for code and conversation, plus image input when **Screen** is enabled. Voice in 0.1 uses local Windows speech, so the coaching model does not need audio support.

## Recommended

For OpenAI, CoCo prefers **GPT-6.1 Sol** when it appears in the authenticated model catalog. This is a balance of coding capability and cost, not a claim that it always beats every other model. The checked fallback order is GPT-6 Sol, GPT-6 Luna, GPT-6 Astra, GPT-5 Mini, GPT-4.1, then GPT-4o. The reason appears below the selector. Astra is a higher-cost option; older models are fallbacks. No recommendation creates an inference request.

The policy is in `src-tauri/model-policy.json`, checked against official model documentation on **2026-10-18**. Each entry links to its source, which documents text/image input, text output, and Responses API support. Exact model IDs and their dated snapshots inherit this policy; specialized variants and unknown families do not. Account discovery must actually return an ID before it can be recommended. Availability does not guarantee inference permissions, quota, future availability, or answer quality.

For Ollama, CoCo reads installed model capabilities from `POST /api/show`. Only models reporting `completion` can be used in the normal selector; screen coaching also requires `vision`. Recommendation favors smaller reported model files to reduce memory demands. When sizes are unavailable it uses a deterministic ordering. This is a local starting point, not a coding benchmark or proof that the model fits your GPU/RAM. No models are loaded or downloaded during discovery.

## Filtering and saving

- The normal dropdown excludes models with incompatible or unknown capabilities. Turning Screen off admits verified text-only models.
- Recommended resolves to a concrete model ID when you save. It does not silently switch an existing compatible saved choice to a new model on later launches.
- An unavailable, incompatible, or unverified saved choice falls back to Recommended in the dialog. The saved configuration changes only on **Save settings**.
- **Enter a model ID manually…** is an explicit fallback for new/custom models that cannot be verified. Known incompatible choices are blocked; unknown choices show an unverified-capabilities note. Their actual compatibility is determined by the provider when used.
- Model discovery errors never imply that a model is verified. Ollama inspection is bounded to 64 models and a 12-second metadata budget, with up to 3 seconds per inspection; uninspected models remain unverified.

## Reasoning effort

Settings includes **Reasoning effort** below Model. Auto is the default for existing and new configurations; it omits `reasoning` from OpenAI requests so the provider uses its model default. Explicit selections persist and are sent as `reasoning.effort` on subsequent coaching requests.

The shared model policy defines supported levels, checked on 2026-10-18: GPT-6.1 Sol and Astra offer Low, Medium, High, Very high (`xhigh`), and Maximum (`max`); GPT-6 Sol and Luna additionally offer None. GPT-5 Mini offers Minimal, Low, Medium, and High. GPT-4.1, GPT-4o, unknown model families, and Ollama use Auto only. Ollama effort control is not implemented in 0.1; Auto preserves the existing local request behavior.

Changing to a model/provider that cannot use the selected effort displays and saves Auto. Native validation checks saved choices again before any coaching request, rejecting unsupported combinations rather than silently ignoring them. Model discovery does not run inference to probe effort support. Higher effort can increase latency and token usage; it does not guarantee a better answer. The existing 2,200 output-token cap (including reasoning) and 120-second request timeout remain; demanding requests can still exhaust those limits.

Sources: [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [GPT-5 family guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5).

## Automatic loading

Opening Settings, changing provider/server URL, or editing/removing the key schedules discovery. Key entry waits **one second after typing stops**; another edit cancels the pending load. Late responses from earlier settings are ignored. Refresh remains available.

Typing a key neither saves it nor submits a coaching request. Only Save settings persists it in Windows Credential Manager. Discovery sends provider authentication and metadata requests, never screenshots, repository contents, or conversation.

Sources: [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [OpenAI model catalog](https://developers.openai.com/api/docs/models), [Ollama show-model API](https://github.com/ollama/ollama/blob/main/docs/api.md#show-model-information).
