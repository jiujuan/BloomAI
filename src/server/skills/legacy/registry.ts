import type { SkillRunner } from '../types'
import { httpApiRunner } from './http-api'
import { jsFunctionRunner } from './js-function'
import { promptTemplateRunner } from './prompt-template'

export const skillRunnerRegistry: Record<string, SkillRunner> = {
  'js-function': jsFunctionRunner,
  'http-api': httpApiRunner,
  'prompt-template': promptTemplateRunner,
}
