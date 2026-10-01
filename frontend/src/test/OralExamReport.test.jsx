import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import ExamReport from '../components/oralExam/ExamReport';
const report={version:1,score:82,core_score:78,bonus_score:4,required_concepts:5,requested_concepts:5,completed_core_concepts:5,follow_up_questions:2,bonus_questions:2,understanding:78,accuracy:78,completeness:78,communication:78,weights:{understanding:.35,accuracy:.35,completeness:.2,communication:.1},strengths:['Clear concepts'],areasForImprovement:['More detail'],topicsCovered:['Routing'],concepts:[{id:'routing',name:'Routing',score:78}],commentary:null};
it('provider failure leaves score, coverage and stored feedback usable; retry changes commentary only',()=>{
  const retry=vi.fn(),view=render(<ExamReport report={report} status="failed" generating={false} error="Provider unavailable" onRetry={retry}/>);
  expect(screen.getByLabelText('Final score')).toHaveTextContent('82');expect(screen.getByText('5 / 5')).toBeInTheDocument();expect(screen.getByText('Clear concepts')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Retry detailed feedback'}));expect(retry).toHaveBeenCalledOnce();
  view.rerender(<ExamReport report={report} status="pending" generating onRetry={retry}/>);
  expect(screen.getByLabelText('Final score')).toHaveTextContent('82');expect(screen.getByRole('button',{name:'Generating detailed feedback…'})).toBeDisabled();
  view.rerender(<ExamReport report={{...report,commentary:{summary:'Written feedback is ready.',strengths:['AI elaboration'],areasForImprovement:['AI practice suggestion']}}} status="ready" generating={false} onRetry={retry}/>);
  expect(screen.getByText('Written feedback is ready.')).toBeInTheDocument();expect(screen.getByLabelText('Final score')).toHaveTextContent('82');expect(screen.queryByRole('button',{name:'Retry detailed feedback'})).toBeNull();
  expect(screen.getByText('Clear concepts')).toBeInTheDocument();expect(screen.getByText('More detail')).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'AI feedback: strengths'})).toBeInTheDocument();expect(screen.getByText('AI elaboration')).toBeInTheDocument();expect(screen.getByText('AI practice suggestion')).toBeInTheDocument();
});

it('legacy report preserves saved score, dimensions and feedback without inventing coverage on refresh',()=>{
  const historical={version:0,legacy:true,score:84,understanding:86,accuracy:82,completeness:80,communication:90,strengths:['Historical strength'],areasForImprovement:['Historical improvement'],topicsCovered:['Historical topic'],summary:'Original saved commentary.'};
  const view=render(<ExamReport report={historical} status="ready"/>);
  for(let i=0;i<3;i++){
    expect(screen.getByLabelText('Final score')).toHaveTextContent('84');
    for(const [label,value] of [['Understanding',86],['Accuracy',82],['Completeness',80],['Communication',90]]){
      const bar=screen.getByRole('progressbar',{name:label});expect(bar).toHaveAttribute('value',String(value));expect(bar.parentElement.querySelector('strong')).toHaveTextContent(String(value));
    }
    for(const text of ['Historical strength','Historical improvement','Historical topic','Original saved commentary.'])expect(screen.getByText(text)).toBeInTheDocument();
    for(const text of [/Completed core concepts/i,/Required concepts/i,/Bonus/i,/Follow-up questions/i,/Incomplete coverage/i,/Core performance/i,/How your core score/])expect(screen.queryByText(text)).toBeNull();
    expect(screen.queryByText(/35%/)).toBeNull();expect(screen.queryByRole('button')).toBeNull();
    view.rerender(<ExamReport report={structuredClone(historical)} status="ready"/>);
  }
});
it('unscored historical reports explain the missing evaluation without offering modern regrading',()=>{
  render(<ExamReport report={{version:0,legacy:true,unscored:true,score:null,summary:'No complete evaluation was saved for this historical exam.'}} status="unavailable"/>);
  expect(screen.getByText('Not scored')).toBeInTheDocument();expect(screen.getByText(/No complete evaluation was saved/)).toBeInTheDocument();expect(screen.queryByRole('button')).toBeNull();expect(screen.queryByText(/Required concepts/i)).toBeNull();
});
it('version-1 reports still show core coverage, bonus and follow-up counts',()=>{
  render(<ExamReport report={report} status="failed" onRetry={()=>{}}/>);
  expect(screen.getByLabelText('Final score')).toHaveTextContent('82');
  for(const [label,value] of [['Core performance','78 / 100'],['Bonus','+4'],['Completed core concepts','5 / 5'],['Follow-up questions','2'],['Bonus questions','2']])expect(screen.getByText(label).nextElementSibling).toHaveTextContent(value);
});
it('incomplete coverage and technical interruption are disclosed without invented marks',()=>{
  render(<ExamReport report={{...report,completed_core_concepts:3,incomplete_coverage:true,termination_reason:'student_ended',technical_interruptions:1,unassessed_answers:1}} status="failed" onRetry={()=>{}}/>);
  expect(screen.getByText('3 / 5')).toBeInTheDocument();expect(screen.getByText(/You ended the exam early/)).toBeInTheDocument();expect(screen.getByText(/No technical-failure penalty/)).toBeInTheDocument();
});
