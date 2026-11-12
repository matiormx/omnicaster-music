import type { Backend } from '../types'
import { backendTauri } from './tauri'
import { backendWeb } from './web'

// La app de escritorio expone __TAURI_INTERNALS__; en el navegador (desarrollo y tests) se usa el backend web.
export const backend: Backend = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? backendTauri : backendWeb
