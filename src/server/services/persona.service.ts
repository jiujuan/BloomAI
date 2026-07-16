import { personaRepo, type Persona } from '../db/repositories/persona.repo'
import { ServiceError } from './errors'

export interface CreatePersonaInput {
  name: string
  system_prompt: string
  model_override?: string | null
}

export interface UpdatePersonaInput {
  name?: string
  system_prompt?: string
  model_override?: string | null
}

export type PersonaDto = Persona

function toPersonaDto(persona: Persona): PersonaDto {
  return { ...persona }
}

function getRequiredPersona(id: string): Persona {
  const persona = personaRepo.get(id)
  if (!persona) throw new ServiceError('NOT_FOUND', 'Persona not found')
  return persona
}

/** Application boundary for persona CRUD and its built-in persona rules. */
export const personaService = {
  list(): PersonaDto[] {
    return personaRepo.list().map(toPersonaDto)
  },

  get(id: string): PersonaDto {
    return toPersonaDto(getRequiredPersona(id))
  },

  create(input: CreatePersonaInput): PersonaDto {
    return toPersonaDto(personaRepo.create({
      name: input.name,
      system_prompt: input.system_prompt,
      model_override: input.model_override ?? null,
    }))
  },

  update(id: string, input: UpdatePersonaInput): PersonaDto {
    getRequiredPersona(id)
    const persona = personaRepo.update(id, input)
    if (!persona) throw new ServiceError('NOT_FOUND', 'Persona not found')
    return toPersonaDto(persona)
  },

  remove(id: string): void {
    const persona = getRequiredPersona(id)
    if (persona.is_builtin) throw new ServiceError('FORBIDDEN', 'Cannot delete built-in persona')

    if (!personaRepo.delete(id)) throw new ServiceError('NOT_FOUND', 'Persona not found')
  },
}