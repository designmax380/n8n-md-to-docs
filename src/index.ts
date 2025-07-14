import express from 'express';
import cors from 'cors';
import type { Request, Response } from 'express';
import type { MarkdownRequest, GoogleDocResponse, ErrorResponse } from './types';
import { convertMarkdownToGoogleDoc } from './services/googleDocs';
import { convertMarkdownToDocx } from './services/docxConverter';

const app = express();

// Middleware
app.use(express.json());
app.use(cors({ origin: true }));

app.post('/', async (req: Request, res: Response) => {
  try {
    console.info('Received request:', {
      body: req.body,
      headers: {
        ...req.headers,
        authorization: req.headers.authorization ? `${req.headers.authorization.substring(0, 20)}...` : undefined
      }
    });

    // Handle array of requests
    const requests: MarkdownRequest[] = Array.isArray(req.body) ? req.body : [req.body];
    console.info(`Processing ${requests.length} request(s)`);
    
    const results = await Promise.all(requests.map(async (request, index) => {
      // Extract request data
      const markdownContent = request.output;
      const authHeader = req.headers.authorization;
      const fileName = request.fileName || 'Converted from Markdown';
      
      console.info(`Request ${index + 1} validation:`, {
        hasMarkdown: !!markdownContent,
        contentLength: markdownContent?.length,
        hasAuthHeader: !!authHeader,
        fileName
      });

      // Validate markdown content
      if (!markdownContent) {
        console.error(`Request ${index + 1}: Missing markdown content`);
        return {
          error: 'Missing required field: output',
          status: 400,
          request: {
            ...request,
            output: undefined
          }
        } as ErrorResponse;
      }

      // Validate authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.error(`Request ${index + 1}: Invalid authorization`);
        return {
          error: 'Missing or invalid authorization header',
          status: 401
        } as ErrorResponse;
      }

      const accessToken = authHeader.split(' ')[1];

      try {
        console.info(`Request ${index + 1}: Starting conversion for "${fileName}"`);
        const result = await convertMarkdownToGoogleDoc(markdownContent, accessToken, fileName);
        console.info(`Request ${index + 1}: Conversion successful:`, result);
        
        return {
          ...result,
          webhookUrl: request.webhookUrl,
          executionMode: request.executionMode
        } as GoogleDocResponse;
      } catch (error: any) {
        console.error(`Request ${index + 1}: Conversion failed:`, {
          error: error.message,
          status: error.status || error.code,
          details: error.errors || error.stack
        });
        
        return {
          error: 'Failed to convert markdown to Google Doc',
          details: error.message,
          status: error.status || 500
        } as ErrorResponse;
      }
    }));

    // Send response
    if (results.length === 1) {
      const result = results[0];
      console.info('Sending single response:', {
        ...result,
        documentContent: undefined
      });
      return res.status(result.status).json(result);
    }

    console.info('Sending multiple responses:', results.length);
    return res.json(results);

  } catch (error: any) {
    console.error('Fatal error processing requests:', {
      error: error.message,
      stack: error.stack
    });
    
    return res.status(500).json({
      error: 'Failed to process requests',
      details: error.message
    } as ErrorResponse);
  }
});

// Add a test endpoint for debugging conversion issues
app.post('/test', async (req: Request, res: Response) => {
  try {
    console.info('Received test request');
    
    const { markdown, fileName } = req.body;
    if (!markdown) {
      return res.status(400).json({ error: 'Missing markdown content' });
    }
    
    // Don't require auth for test endpoint (only in development)
    if (process.env.NODE_ENV !== 'production') {
      console.info('Test conversion:', {
        markdownSample: markdown.substring(0, 100),
        markdownLength: markdown.length
      });
      
      const result = await convertMarkdownToDocx(markdown);
      console.info('Test conversion complete', {
        resultSize: result.length
      });
      
      // Return the DOCX buffer directly for testing
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName || 'test.docx'}"`);
      return res.send(Buffer.from(result));
    } else {
      return res.status(403).json({ error: 'Test endpoint not available in production' });
    }
  } catch (error: any) {
    console.error('Error in test endpoint:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app; 