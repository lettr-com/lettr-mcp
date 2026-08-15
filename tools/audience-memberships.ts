import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LettrClient, LettrResponse } from '../lettr.js';

export function addAudienceMembershipTools(
  server: McpServer,
  lettr: LettrClient,
) {
  server.registerTool(
    'attach-contact-to-list',
    {
      title: 'Attach Contact to List',
      description:
        'Add a single contact to a single list. Both the contact and the list must belong to your team.',
      inputSchema: {
        contactId: z.string().nonempty().describe('The contact ID'),
        listId: z.string().nonempty().describe('The list ID'),
      },
    },
    async ({ contactId, listId }) => {
      await lettr.post<{ message: string } | undefined>(
        `/audience/contacts/${encodeURIComponent(contactId)}/lists/${encodeURIComponent(listId)}`,
      );

      return {
        content: [
          {
            type: 'text',
            text: `Contact "${contactId}" attached to list "${listId}".`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'detach-contact-from-list',
    {
      title: 'Detach Contact from List',
      description: 'Remove a single contact from a single list.',
      inputSchema: {
        contactId: z.string().nonempty().describe('The contact ID'),
        listId: z.string().nonempty().describe('The list ID'),
      },
    },
    async ({ contactId, listId }) => {
      await lettr.delete<{ message: string } | undefined>(
        `/audience/contacts/${encodeURIComponent(contactId)}/lists/${encodeURIComponent(listId)}`,
      );

      return {
        content: [
          {
            type: 'text',
            text: `Contact "${contactId}" detached from list "${listId}".`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'subscribe-contact-to-topic',
    {
      title: 'Subscribe Contact to Topic',
      description:
        'Subscribe a single contact to a single topic. Both must belong to your team.',
      inputSchema: {
        contactId: z.string().nonempty().describe('The contact ID'),
        topicId: z.string().nonempty().describe('The topic ID'),
      },
    },
    async ({ contactId, topicId }) => {
      await lettr.post<{ message: string } | undefined>(
        `/audience/contacts/${encodeURIComponent(contactId)}/topics/${encodeURIComponent(topicId)}`,
      );

      return {
        content: [
          {
            type: 'text',
            text: `Contact "${contactId}" subscribed to topic "${topicId}".`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'unsubscribe-contact-from-topic',
    {
      title: 'Unsubscribe Contact from Topic',
      description: 'Unsubscribe a single contact from a single topic.',
      inputSchema: {
        contactId: z.string().nonempty().describe('The contact ID'),
        topicId: z.string().nonempty().describe('The topic ID'),
      },
    },
    async ({ contactId, topicId }) => {
      await lettr.delete<{ message: string } | undefined>(
        `/audience/contacts/${encodeURIComponent(contactId)}/topics/${encodeURIComponent(topicId)}`,
      );

      return {
        content: [
          {
            type: 'text',
            text: `Contact "${contactId}" unsubscribed from topic "${topicId}".`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'bulk-attach-contacts-to-lists',
    {
      title: 'Bulk Attach Contacts to Lists',
      description:
        'Attach multiple contacts to multiple lists at once. Every contact is attached to every list (a cartesian product of contact_ids × list_ids). All IDs must belong to your team.',
      inputSchema: {
        contact_ids: z
          .array(z.string().nonempty())
          .min(1)
          .max(1000)
          .describe('Contact IDs to attach (max 1000)'),
        list_ids: z
          .array(z.string().nonempty())
          .min(1)
          .max(50)
          .describe('List IDs to attach the contacts to (max 50)'),
      },
    },
    async ({ contact_ids, list_ids }) => {
      const response = await lettr.post<
        LettrResponse<{
          attached: number;
          already_attached: number;
          total_pairs: number;
        }>
      >('/audience/contacts/lists/bulk', { contact_ids, list_ids });

      const { attached, already_attached, total_pairs } = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Attached ${attached} of ${total_pairs} contact-list pair(s); ${already_attached} were already attached.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'bulk-detach-contacts-from-lists',
    {
      title: 'Bulk Detach Contacts from Lists',
      description:
        'Detach multiple contacts from multiple lists at once (a cartesian product of contact_ids × list_ids). Before using this tool, you MUST double-check with the user, as it removes many memberships at once.',
      inputSchema: {
        contact_ids: z
          .array(z.string().nonempty())
          .min(1)
          .max(1000)
          .describe('Contact IDs to detach (max 1000)'),
        list_ids: z
          .array(z.string().nonempty())
          .min(1)
          .max(50)
          .describe('List IDs to detach the contacts from (max 50)'),
      },
    },
    async ({ contact_ids, list_ids }) => {
      const response = await lettr.delete<
        LettrResponse<{
          detached: number;
          not_present: number;
          total_pairs: number;
        }>
      >('/audience/contacts/lists/bulk', { contact_ids, list_ids });

      const { detached, not_present, total_pairs } = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Detached ${detached} of ${total_pairs} contact-list pair(s); ${not_present} were not attached.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'bulk-subscribe-contacts-to-topics',
    {
      title: 'Bulk Subscribe Contacts to Topics',
      description:
        'Subscribe multiple contacts to multiple topics at once. Every contact is subscribed to every topic (a cartesian product of contact_ids × topic_ids). All IDs must belong to your team.',
      inputSchema: {
        contact_ids: z
          .array(z.string().nonempty())
          .min(1)
          .max(1000)
          .describe('Contact IDs to subscribe (max 1000)'),
        topic_ids: z
          .array(z.string().nonempty())
          .min(1)
          .max(50)
          .describe('Topic IDs to subscribe the contacts to (max 50)'),
      },
    },
    async ({ contact_ids, topic_ids }) => {
      const response = await lettr.post<
        LettrResponse<{
          subscribed: number;
          already_subscribed: number;
          total_pairs: number;
        }>
      >('/audience/contacts/topics/bulk', { contact_ids, topic_ids });

      const { subscribed, already_subscribed, total_pairs } = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Subscribed ${subscribed} of ${total_pairs} contact-topic pair(s); ${already_subscribed} were already subscribed.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'bulk-unsubscribe-contacts-from-topics',
    {
      title: 'Bulk Unsubscribe Contacts from Topics',
      description:
        'Unsubscribe multiple contacts from multiple topics at once (a cartesian product of contact_ids × topic_ids). Before using this tool, you MUST double-check with the user, as it drops many subscriptions at once.',
      inputSchema: {
        contact_ids: z
          .array(z.string().nonempty())
          .min(1)
          .max(1000)
          .describe('Contact IDs to unsubscribe (max 1000)'),
        topic_ids: z
          .array(z.string().nonempty())
          .min(1)
          .max(50)
          .describe('Topic IDs to unsubscribe the contacts from (max 50)'),
      },
    },
    async ({ contact_ids, topic_ids }) => {
      const response = await lettr.delete<
        LettrResponse<{
          unsubscribed: number;
          total_pairs: number;
        }>
      >('/audience/contacts/topics/bulk', { contact_ids, topic_ids });

      const { unsubscribed, total_pairs } = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Unsubscribed ${unsubscribed} of ${total_pairs} contact-topic pair(s).`,
          },
        ],
      };
    },
  );
}
