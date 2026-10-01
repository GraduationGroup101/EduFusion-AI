export default function ExamReport({report,status,generating,error,onRetry}){
  if(!report)return <div role="status"><p>{error||'Preparing your evaluation…'}</p><button className="btn-secondary" disabled={generating} aria-busy={generating} onClick={onRetry}>{generating?'Generating detailed feedback…':'Retry detailed feedback'}</button></div>;
  const commentary=report.commentary||(!report.version?{summary:report.summary}:null);
  return <>
    <div className="oral-score" aria-label="Final score"><strong>{report.score??'—'}</strong><span>{report.score==null?'Not scored':'out of 100'}</span></div>
    {report.version&&<>
      <dl className="oral-coverage">
        <div><dt>Core performance</dt><dd>{report.core_score??'—'} / 100</dd></div><div><dt>Bonus</dt><dd>+{report.bonus_score}</dd></div>
        <div><dt>Required concepts</dt><dd>{report.required_concepts}</dd></div><div><dt>Completed core concepts</dt><dd>{report.completed_core_concepts} / {report.required_concepts}</dd></div>
        <div><dt>Follow-up questions</dt><dd>{report.follow_up_questions}</dd></div><div><dt>Bonus questions</dt><dd>{report.bonus_questions}</dd></div>
      </dl>
      {report.incomplete_coverage&&<p role="status">Incomplete coverage. {report.termination_reason==='student_ended'?'You ended the exam early.':report.termination_reason==='time_limit'?'The exam time expired.':'The interview ended before all core concepts were assessed.'} Your score uses completed, assessed concepts only; untested concepts receive no invented score.</p>}
      {(report.technical_interruptions>0||report.unassessed_answers>0)&&<p role="status">Technical interruptions or unfinished assessments limited this evaluation. {report.unassessed_answers} saved answer(s) could not be assessed. No technical-failure penalty has been applied.</p>}
      {report.required_concepts<report.requested_concepts&&<p>The material supported {report.required_concepts} distinct core concepts out of the target of {report.requested_concepts}.</p>}
    </>}
    <div className="oral-breakdown">{[['understanding','Understanding'],['accuracy','Accuracy'],['completeness','Completeness'],['communication','Communication']].map(([key,label])=><div key={key}><span>{label} <small>{Math.round((report.weights?.[key]??({understanding:.4,accuracy:.3,completeness:.2,communication:.1}[key]))*100)}%</small></span><strong>{report[key]??'—'}</strong><progress value={report[key]||0} max="100" aria-label={label}/></div>)}</div>
    <div className="oral-feedback">{[['strengths','Strong areas'],['areasForImprovement','Needs improvement'],['topicsCovered','Topics covered']].map(([key,label])=><div key={key}><h3>{label}</h3><ul>{report[key]?.map((item,i)=><li key={i}>{item}</li>)}</ul></div>)}</div>
    {report.concepts?.length>0&&<details><summary>How your core score was calculated</summary><p>Each concept has equal weight. An initial answer contributes 60% and the average of its assessed follow-ups contributes 40%. Without an assessed follow-up, the initial answer contributes 100%. The best assessed bonus above 60 can add up to five points. Final scores are capped at 100.</p><ul>{report.concepts.map(c=><li key={c.id}>{c.name}: {c.score} / 100</li>)}</ul></details>}
    <section aria-label="Overall feedback"><h3>Overall feedback</h3>{commentary?<p>{commentary.summary}</p>:<div className="oral-feedback-state" role="status"><p>{report.score==null?'Your saved answers and coverage are available.':'Your evaluation is complete.'} {generating?'Detailed AI feedback is being prepared.':'Detailed AI feedback is temporarily unavailable and can be retried.'}</p>{error&&<p className="oral-hint">{error}</p>}<button className="btn-secondary" disabled={generating} aria-busy={generating} onClick={onRetry}>{generating?'Generating detailed feedback…':'Retry detailed feedback'}</button></div>}{status==='ready'&&!commentary&&<p>{report.summary}</p>}</section>
  </>;
}
