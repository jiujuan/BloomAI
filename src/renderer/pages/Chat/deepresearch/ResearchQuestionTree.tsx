import React from 'react'
import type { ResearchCoverageDto, ResearchQuestionDto } from '@shared/deepresearch/contracts'

export function questionCoveragePercent(coverage: ResearchCoverageDto | null): number {
  if (!coverage) return 0
  const score = coverage.score > 1 ? coverage.score : coverage.score * 100
  return Math.max(0, Math.min(100, Math.round(score)))
}

function QuestionItem({ question, children }: { question: ResearchQuestionDto; children: ResearchQuestionDto[] }) {
  const coverage = questionCoveragePercent(question.coverage)
  return (
    <li className="research-question-item">
      <div className="research-question-row">
        <span className="research-question-ordinal">{question.ordinal}</span>
        <div className="research-question-copy">
          <strong>{question.question}</strong>
          <span>{question.intent}</span>
        </div>
        <span className="research-question-coverage">{coverage}% 覆盖</span>
        <span className="research-status-badge" data-status={question.status}>{question.status}</span>
      </div>
      {question.coverage?.gaps.length ? <p className="research-question-gaps">缺口：{question.coverage.gaps.join('；')}</p> : null}
      {children.length > 0 && <ul className="research-question-children">{children.map((child) => <QuestionItem key={child.id} question={child} children={[]} />)}</ul>}
    </li>
  )
}

export function ResearchQuestionTree({ questions }: { questions: ResearchQuestionDto[] }) {
  const roots = questions.filter((question) => !question.parentQuestionId)
  const childrenByParent = new Map<string, ResearchQuestionDto[]>()
  for (const question of questions) {
    if (!question.parentQuestionId) continue
    childrenByParent.set(question.parentQuestionId, [...(childrenByParent.get(question.parentQuestionId) ?? []), question])
  }
  return (
    <section className="research-section" aria-labelledby="research-questions-heading">
      <div className="research-section-heading"><h3 id="research-questions-heading">研究问题</h3><span>{questions.length} 项</span></div>
      {roots.length > 0 ? <ol className="research-question-list">{roots.map((question) => <QuestionItem key={question.id} question={question} children={childrenByParent.get(question.id) ?? []} />)}</ol> : <p className="research-empty">问题规划完成后会显示在这里。</p>}
    </section>
  )
}
