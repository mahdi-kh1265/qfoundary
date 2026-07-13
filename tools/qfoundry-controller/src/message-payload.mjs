export function messagePayload(message) {
  if (message.payload && typeof message.payload === 'object') {
    return message.payload
  }
  if (typeof message.payload === 'string') {
    try {
      const parsed = JSON.parse(message.payload)
      if (parsed && typeof parsed === 'object') {
        return parsed
      }
    } catch {}
  }
  return message
}
