# `@flinter/dsh-native-event-consumer`

Status: **PHASE1_LOCAL_COMPATIBILITY_PROBE**.

This Phase 1 probe reads native alpha session events without changing the
Session codec. It checks that the required event types are present and fails
closed when one is missing. It is not a trace-link implementation, does not
persist or reinterpret events, and is not loaded by the alpha profile.

## Model Experience

### Native event compatibility probe

#### What the model sees

`@flinter/dsh-native-event-consumer` observes native session events after a run and changes no model, prompt, reasoning, or provider behavior.

#### Token effect

Event observation does not add, remove, or price tokens.

#### KV Cache effect

Event observation registers no cache policy.
