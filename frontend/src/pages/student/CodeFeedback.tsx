import { useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Paper, Stack, Text, Accordion } from '@mantine/core';
import { post, type SubmissionDetail } from '../../api/client';
import { CodeBlock } from '../../components';
import { notify } from '../../notify';

export default function CodeFeedback({ submission, refresh }: { submission: SubmissionDetail; refresh: () => void }) {
  const feedback = submission.report?.code_feedback;
  const job = submission.feedback_job;
  const pending = job?.status === 'queued' || job?.status === 'running';
  const [requesting, setRequesting] = useState(false);
  const request = async () => {
    setRequesting(true);
    try {
      await post(`/submissions/${submission.id}/feedback`);
      refresh();
    } catch (error) { notify.error(error, 'Could not request code feedback'); }
    finally { setRequesting(false); }
  };
  return <Paper withBorder p="md" radius="md">
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={600}>Code issues and AI feedback</Text>
        <Button size="xs" variant="light" onClick={request} loading={requesting} disabled={pending}>
          {feedback ? 'Review again' : 'Analyze my code'}
        </Button>
      </Group>
      {pending && <Group gap="xs"><Loader size="xs" /><Text size="sm">
        {job.status === 'queued' ? 'AI feedback is queued.' : 'AI is reviewing your source code.'} Your measured grade is ready. This section updates automatically.
      </Text></Group>}
      {(job?.status === 'failed' || job?.status === 'cancelled') &&
        <Alert color="orange">{job.error || 'The feedback job stopped. Request another review.'}</Alert>}
      {feedback?.status === 'unavailable' && <Alert color="orange">{feedback.error || 'AI feedback is unavailable.'} Tool findings remain available below.</Alert>}
      <Text size="sm" c="dimmed">Compiler findings come from the build. AI observations are suggestions to investigate; matching source lines does not prove that a proposed fix is correct.</Text>
      {!feedback && !pending && <Text size="sm">Request a review to get source locations, explanations and suggested changes.</Text>}
      {feedback?.issues.map((issue, index) => <Paper withBorder p="sm" key={`${issue.line}-${index}`}>
        <Stack gap="xs">
          <Group gap="xs">
            <Badge color={issue.basis === 'compiler' ? 'red' : 'blue'} variant="light">
              {issue.basis === 'compiler' ? 'Compiler finding' : issue.basis === 'tool' ? 'Tool finding' : 'AI suggestion'}
            </Badge>
            <Text fw={500} size="sm">{issue.metric.replace(/_/g, ' ')} · Line {issue.line}{issue.end_line !== issue.line ? `–${issue.end_line}` : ''}</Text>
          </Group>
          <CodeBlock code={issue.code} lineNumbers startLine={issue.line} label="Your code" maxHeight={200} />
          <Text size="sm"><strong>Why:</strong> {issue.explanation}</Text>
          <Text size="sm"><strong>Suggested change:</strong> {issue.suggestion}</Text>
          {issue.replacement && <CodeBlock code={issue.replacement} label="Proposed edit (not applied)" maxHeight={200} />}
          {issue.verification?.verified && <Text size="sm" c="teal">
            Tested edit: {issue.verification.passed_before} → {issue.verification.passed_after} of {issue.verification.tests_total} tests pass, with no regression on the tests checked. Your submission and grade are unchanged.
          </Text>}
        </Stack>
      </Paper>)}
      {feedback?.status === 'done' && feedback.issues.length === 0 &&
        <Text size="sm">No source-anchored issue was returned. This does not prove the program is correct; check the measured failures and metric results.</Text>}
      {!!feedback?.rejected_locations && <Text size="xs" c="dimmed">Some suggestions were withheld because their quoted code did not match your submission.</Text>}
      {!!feedback?.withheld_unverified && <Text size="xs" c="dimmed">Some correctness suggestions were withheld because no specific edit could be verified to improve the tests.</Text>}
      {!!feedback?.reviews.length && <Accordion variant="contained">
        <Accordion.Item value="metrics"><Accordion.Control>AI comments for each metric</Accordion.Control>
          <Accordion.Panel><Stack gap="sm">{feedback.reviews.map(review =>
            <div key={review.metric}><Text fw={500} size="sm">{review.metric.replace(/_/g, ' ')}</Text><Text size="sm">{review.comment}</Text></div>
          )}</Stack></Accordion.Panel>
        </Accordion.Item>
      </Accordion>}
    </Stack>
  </Paper>;
}
