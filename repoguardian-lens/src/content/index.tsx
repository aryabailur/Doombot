import { mountLens } from './mountLens'

try {
  mountLens()
} catch {
  // The toolbar action remains available if GitHub changes enough to block injection.
}
