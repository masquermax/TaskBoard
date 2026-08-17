from pathlib import Path

path = Path('src/core/root-runtime.js')
text = path.read_text()

anchor = "function clone(value) { return JSON.parse(JSON.stringify(value)); }\n"
replacement = anchor + "const MAX_PLANNING_REPAIRS = 1;\n"
assert text.count(anchor) == 1, f'clone anchor count={text.count(anchor)}'
assert 'const MAX_PLANNING_REPAIRS = 1;' not in text
text = text.replace(anchor, replacement, 1)

old = """        if(plan.contributionIssues?.length){
          const reason=`ROOT_WORK_WITHOUT_GOVERNED_CONTRIBUTION: ${plan.contributionIssues.join(' | ')}`;
          if(this.hasUnfinishedWork(session)){session.actor={title:'Root 推进边界',status:WorkUnitStatus.COMPLETED,detail:'新 Work 缺少明确 governed contribution；不启动它，继续等待已签发 Work。',updatedAt:nowIso(),owner:'root'};this.emit(session,callbacks);continue;}
          const snapshot=this.makeSnapshot(session);this.discardSession(task.id);return{kind:'suspended',reason,snapshot,quiescent:true};
        }
"""
new = """        if(plan.contributionIssues?.length){
          plan.issues.push(...plan.contributionIssues.map(issue=>`ROOT_WORK_WITHOUT_GOVERNED_CONTRIBUTION: ${issue}`));
          plan.valid=false;
        }
"""
assert text.count(old) == 1, f'contribution block count={text.count(old)}'
text = text.replace(old, new, 1)

old_limit = "if(session.planningRepairCount>=MAX_TOTAL_ATTEMPTS)"
new_limit = "if(session.planningRepairCount>MAX_PLANNING_REPAIRS)"
assert text.count(old_limit) == 2, f'planning limit count={text.count(old_limit)}'
text = text.replace(old_limit, new_limit)

path.write_text(text)
