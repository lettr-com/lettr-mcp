import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LettrClient, LettrResponse } from '../lettr.js';

interface HealthData {
  status: string;
  timestamp: string;
}

interface AuthCheckData {
  team_id: number;
  timestamp: string;
}

export function addSystemTools(server: McpServer, lettr: LettrClient) {
  server.registerTool(
    'health-check',
    {
      title: 'Health Check',
      description:
        'Check the Lettr API health status. Returns the current API status and a server timestamp. This endpoint does not require authentication.',
      inputSchema: {},
    },
    async () => {
      const response = await lettr.get<LettrResponse<HealthData>>('/health');
      const { status, timestamp } = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Lettr API status: ${status} (server time: ${timestamp})`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'auth-check',
    {
      title: 'Validate API Key',
      description:
        'Validate the configured Lettr API key and return the associated team ID. Use this to verify that the API key is correctly set up before performing other operations.',
      inputSchema: {},
    },
    async () => {
      const response =
        await lettr.get<LettrResponse<AuthCheckData>>('/auth/check');
      const { team_id, timestamp } = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `API key is valid. Team ID: ${team_id} (server time: ${timestamp})`,
          },
        ],
      };
    },
  );
}
