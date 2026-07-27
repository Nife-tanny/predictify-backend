import { Router } from "express";

export const tagsRouter = Router();

/**
 * @openapi
 * /api/tags:
 *   get:
 *     summary: Retrieve system tags
 *     description: Returns a list of tags. Used to test the tags access log.
 *     tags:
 *       - Tags
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Maximum number of tags to return
 *     responses:
 *       200:
 *         description: A list of tags
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tags:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
tagsRouter.get("/", (req, res) => {
  const limitQuery = req.query.limit;
  const limit = limitQuery ? parseInt(limitQuery as string, 10) : 10;
  
  if (isNaN(limit) || limit < 1 || limit > 100) {
    res.status(400).json({ error: { code: "invalid_input", message: "Limit must be between 1 and 100" } });
    return;
  }

  const allTags = ["stellar", "wave", "fwc26"];
  res.json({ tags: allTags.slice(0, limit) });
});
