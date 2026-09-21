import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ProgressResponse } from '@/lib/api';

interface ProgressPanelProps {
  courseId: string;
  userId: string;
}

const ProgressPanel: React.FC<ProgressPanelProps> = ({ courseId, userId }) => {
  const { data: progressData, isLoading, error } = useQuery({
    queryKey: ['courseProgress', courseId, userId],
    queryFn: async () => {
      const response = await fetch(`/api/courses/${courseId}/progress?user_id=${userId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch progress data');
      }
      return response.json() as Promise<ProgressResponse[]>;
    },
  });

  if (isLoading) return <div>Loading progress...</div>;
  if (error) return <div>Error loading progress: {error.message}</div>;

  return (
    <div className="p-4 border rounded-lg">
      <h2 className="text-lg font-semibold mb-4">Review Progress</h2>
      {progressData && progressData.length > 0 ? (
        <ul className="space-y-2">
          {progressData.map((progress) => (
            <li key={progress.source_question_id} className="p-2 border rounded">
              <div>Question ID: {progress.source_question_id}</div>
              <div>Stage: {progress.stage}</div>
              <div>Due At: {progress.due_at ? new Date(progress.due_at).toLocaleString() : 'N/A'}</div>
              <div>Last Attempted: {progress.last_attempted_at ? new Date(progress.last_attempted_at).toLocaleString() : 'N/A'}</div>
            </li>
          ))}
        </ul>
      ) : (
        <div>No progress data available.</div>
      )}
    </div>
  );
};

export default ProgressPanel;