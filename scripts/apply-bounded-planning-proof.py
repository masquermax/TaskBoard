from pathlib import Path

path = Path('tests/scheduler.test.js')
text = path.read_text()
old = "assert.equal(rounds,6,'the first bounded Work Unit runs once; repeated semantic re-issuance is then rejected through the normal planning-repair cycle')"
new = "assert.equal(rounds,3,'the first bounded Work Unit runs once; one repeated semantic re-issuance gets one planning repair, and the next invalid plan fails closed')"
assert text.count(old) == 1, f'expected one old rounds assertion, found {text.count(old)}'
path.write_text(text.replace(old, new, 1))
