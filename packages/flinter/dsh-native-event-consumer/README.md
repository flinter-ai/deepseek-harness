# `@flinter/dsh-native-event-consumer`

Status: **PHASE1_LOCAL_COMPATIBILITY_PROBE**.

This Phase 1 probe reads native alpha session events without changing the
Session codec. It checks that the required event types are present and fails
closed when one is missing. It is not a trace-link implementation, does not
persist or reinterpret events, and is not loaded by the alpha profile.
