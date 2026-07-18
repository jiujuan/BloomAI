import { Agent } from '@mastra/core/agent'
import type { ResearchBriefQuestionPlanDto, ResearchRunDto } from '@shared/deepresearch/contracts'
import { getResearchProfilePolicy } from '@server/deepresearch/domain/profiles'
import { throwIfCancellationRequested } from '@server/deepresearch/domain/cancellation'
import { resolveMastraModel } from '../../model-resolver'

export interface BriefClarificationPlan {
  question: string
  intent: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  requiredEvidenceTypes: string[]
}

export type BriefQuestionPlan = ResearchBriefQuestionPlanDto

export interface BriefPlan {
  title: string
  objective: string | null
  audience: string | null
  scope: string
  definition?: string | null
  timeframe?: string | null
  geography?: string | null
  deliverables?: string[]
  assumptions: string[]
  plannedSections: string[]
  questions?: BriefQuestionPlan[]
  criticalClarifications: BriefClarificationPlan[]
}

export interface BriefPlanner {
  plan(run: ResearchRunDto, options?: { signal?: AbortSignal }): Promise<BriefPlan>
}

export const briefPlannerAgent = new Agent({
  id: 'deep-research-brief-planner',
  name: 'BloomAI Deep Research Brief Planner',
  instructions: [
    'Create an objective, topic-specific research brief for the supplied topic.',
    'Create complementary research questions that name the topic, relevant entities, and the decision each question serves.',
    'Use the profile only as a minimum structural constraint; never expose profile category labels as questions.',
    'For a broad but researchable topic, make stated default assumptions and continue rather than asking a clarification.',
    'Only include critical clarifications when the topic cannot support meaningful research without an answer.',
    'Return structured scope, definition, audience, time and geography, deliverables, assumptions, sections, questions, and critical clarification questions.',
  ].join(' '),
  model: ({ requestContext }) => resolveMastraModel(requestContext?.get('model') as string | undefined),
})

function question(
  topic: string,
  values: Omit<BriefQuestionPlan, 'question'> & { question: (topic: string) => string },
): BriefQuestionPlan {
  return { ...values, question: values.question(topic) }
}

/**
 * Compatibility fallback for injected legacy planners. It still creates user-visible,
 * topic-bound questions; profile labels are never emitted as query text.
 */
export function createTopicBoundQuestionPlans(run: ResearchRunDto): BriefQuestionPlan[] {
  const commonRisk = question(run.topic, {
    question: (topic) => `What material risks, limitations, and uncertainties should decision-makers consider for ${topic}?`,
    intent: 'identify material risks and limitations', priority: 'high', sectionKey: 'risks-and-limitations', questionType: 'risk-analysis',
    needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: false, sourceTargets: ['regulatory guidance', 'independent analysis'],
  })

  if (run.profile === 'market') {
    return [
      question(run.topic, { question: (topic) => `Which product categories, boundaries, and use cases define ${topic}?`, intent: 'define the market category and scope', priority: 'high', sectionKey: 'market-definition', questionType: 'definition', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: false, sourceTargets: ['product documentation', 'industry terminology'] }),
      question(run.topic, { question: (topic) => `Which representative vendors offer ${topic}, and how are their products positioned?`, intent: 'identify representative vendors and positioning', priority: 'high', sectionKey: 'market-and-competition', questionType: 'competitive-landscape', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: false, sourceTargets: ['company product pages', 'independent market analysis'] }),
      question(run.topic, { question: (topic) => `What technical architecture, integrations, and operational capabilities underpin ${topic}?`, intent: 'explain technical architecture and capabilities', priority: 'high', sectionKey: 'product-and-technology', questionType: 'technical-analysis', needPrimarySource: true, needRecentSource: false, needQuantitativeEvidence: false, sourceTargets: ['technical documentation', 'integration documentation'] }),
      question(run.topic, { question: (topic) => `Which first- and third-party data sources support ${topic}, and what provenance or governance constraints apply?`, intent: 'assess data sources and governance', priority: 'high', sectionKey: 'data-and-workflows', questionType: 'data-governance', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: false, sourceTargets: ['privacy documentation', 'regulatory guidance'] }),
      question(run.topic, { question: (topic) => `Which buyer segments, sales scenarios, and operating workflows benefit most from ${topic}?`, intent: 'analyze buyer segments and use cases', priority: 'medium', sectionKey: 'data-and-workflows', questionType: 'use-case-analysis', needPrimarySource: false, needRecentSource: true, needQuantitativeEvidence: true, sourceTargets: ['customer case studies', 'buyer surveys'] }),
      question(run.topic, { question: (topic) => `What market size, growth signals, demand drivers, and competitive dynamics are reported for ${topic}?`, intent: 'analyze market size and growth', priority: 'high', sectionKey: 'market-and-competition', questionType: 'market-analysis', needPrimarySource: false, needRecentSource: true, needQuantitativeEvidence: true, sourceTargets: ['industry association data', 'research institute data'] }),
      commonRisk,
    ]
  }

  if (run.profile === 'competitor') {
    return [
      question(run.topic, { question: (topic) => `What decision, category, and comparison boundary should frame ${topic}?`, intent: 'define the comparison scope', priority: 'high', sectionKey: 'positioning', questionType: 'definition', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: false, sourceTargets: ['company materials', 'independent analysis'] }),
      question(run.topic, { question: (topic) => `Which organizations are the most relevant alternatives for ${topic}, and who do they target?`, intent: 'identify competitors and target customers', priority: 'high', sectionKey: 'positioning', questionType: 'competitive-landscape', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: false, sourceTargets: ['company product pages', 'customer evidence'] }),
      question(run.topic, { question: (topic) => `How do product capabilities, technical approaches, and integrations differ for ${topic}?`, intent: 'compare products and technology', priority: 'high', sectionKey: 'capability-comparison', questionType: 'technical-comparison', needPrimarySource: true, needRecentSource: false, needQuantitativeEvidence: false, sourceTargets: ['product documentation', 'integration documentation'] }),
      question(run.topic, { question: (topic) => `How do pricing, packaging, channels, and partners affect competition in ${topic}?`, intent: 'compare commercial model and routes to market', priority: 'medium', sectionKey: 'pricing-and-packaging', questionType: 'commercial-analysis', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: true, sourceTargets: ['pricing pages', 'partner materials'] }),
      commonRisk,
    ]
  }

  if (run.profile === 'academic') {
    return [
      question(run.topic, { question: (topic) => `How is ${topic} defined, and which terms should be distinguished?`, intent: 'define terminology', priority: 'high', sectionKey: 'terminology', questionType: 'definition', needPrimarySource: true, needRecentSource: false, needQuantitativeEvidence: false, sourceTargets: ['peer-reviewed papers', 'foundational sources'] }),
      question(run.topic, { question: (topic) => `What foundational and recent studies establish the state of knowledge about ${topic}?`, intent: 'review foundational and recent literature', priority: 'high', sectionKey: 'literature-review', questionType: 'literature-review', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: false, sourceTargets: ['peer-reviewed papers', 'conference papers'] }),
      question(run.topic, { question: (topic) => `Which methods, datasets, and evaluation practices are used to study ${topic}?`, intent: 'analyze methods and datasets', priority: 'high', sectionKey: 'methodology-review', questionType: 'methodology-analysis', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: true, sourceTargets: ['methods papers', 'dataset documentation'] }),
      question(run.topic, { question: (topic) => `Which findings about ${topic} are well-supported, contested, or not yet reproducible?`, intent: 'assess findings and disagreements', priority: 'high', sectionKey: 'findings', questionType: 'evidence-synthesis', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: true, sourceTargets: ['replication studies', 'systematic reviews'] }),
      commonRisk,
    ]
  }

  return [
    question(run.topic, { question: (topic) => `How should ${topic} be defined, bounded, and distinguished from adjacent concepts?`, intent: 'define the topic and scope', priority: 'high', sectionKey: 'findings-by-question', questionType: 'definition', needPrimarySource: true, needRecentSource: false, needQuantitativeEvidence: false, sourceTargets: ['primary sources', 'authoritative references'] }),
    question(run.topic, { question: (topic) => `What is the current state, mechanism, and stakeholder context for ${topic}?`, intent: 'explain current state and mechanism', priority: 'high', sectionKey: 'findings-by-question', questionType: 'landscape-analysis', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: false, sourceTargets: ['official sources', 'primary research'] }),
    question(run.topic, { question: (topic) => `What empirical evidence and quantitative indicators support or challenge claims about ${topic}?`, intent: 'assess quantitative evidence', priority: 'high', sectionKey: 'findings-by-question', questionType: 'evidence-analysis', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: true, sourceTargets: ['primary studies', 'official statistics'] }),
    question(run.topic, { question: (topic) => `What alternative explanations, disagreements, and practical implications exist for ${topic}?`, intent: 'analyze disagreement and implications', priority: 'medium', sectionKey: 'alternative-explanations', questionType: 'comparative-analysis', needPrimarySource: false, needRecentSource: true, needQuantitativeEvidence: false, sourceTargets: ['independent analysis', 'reputable secondary sources'] }),
    commonRisk,
  ]
}

export function createDeterministicBriefPlanner(): BriefPlanner {
  return {
    async plan(run: ResearchRunDto, options = {}): Promise<BriefPlan> {
      throwIfCancellationRequested(options)
      const policy = getResearchProfilePolicy(run.profile)
      const questions = createTopicBoundQuestionPlans(run)
      const plan: BriefPlan = {
        title: run.topic,
        objective: run.topic,
        audience: null,
        scope: run.topic,
        definition: null,
        timeframe: null,
        geography: null,
        deliverables: ['Research brief', 'Evidence-backed report'],
        assumptions: ['The research is limited to sources available through configured capabilities.', 'No geography or time range was supplied; broad defaults are stated in the report.'],
        plannedSections: [...new Set([...policy.requiredSections, ...questions.map((item) => item.sectionKey)])],
        questions,
        criticalClarifications: [],
      }
      throwIfCancellationRequested(options)
      return plan
    },
  }
}
