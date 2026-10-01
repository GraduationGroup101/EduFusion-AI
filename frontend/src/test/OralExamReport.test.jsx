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
  view.rerender(<ExamReport report={{...report,commentary:{summary:'Written feedback is ready.'}}} status="ready" generating={false} onRetry={retry}/>);
  expect(screen.getByText('Written feedback is ready.')).toBeInTheDocument();expect(screen.getByLabelText('Final score')).toHaveTextContent('82');expect(screen.queryByRole('button',{name:'Retry detailed feedback'})).toBeNull();
});
it('incomplete coverage and technical interruption are disclosed without invented marks',()=>{
  render(<ExamReport report={{...report,completed_core_concepts:3,incomplete_coverage:true,termination_reason:'student_ended',technical_interruptions:1,unassessed_answers:1}} status="failed" onRetry={()=>{}}/>);
  expect(screen.getByText('3 / 5')).toBeInTheDocument();expect(screen.getByText(/You ended the exam early/)).toBeInTheDocument();expect(screen.getByText(/No technical-failure penalty/)).toBeInTheDocument();
});
