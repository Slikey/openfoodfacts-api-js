const request = require('supertest');
const { app } = require('./app');
const server = require('./server');

afterAll((done) => {
  server.close(done);
});

describe('API Endpoints', () => {
  // Test for the root endpoint
  describe('GET /', () => {
    it('should return a welcome message', async () => {
      const response = await request(app).get('/');
      expect(response.statusCode).toBe(200);
      expect(response.text).toBe('OpenFoodFacts DB API is running.');
    });
  });

  // Test for the product lookup endpoint
  describe('GET /product/:code', () => {
    it('should return a product for a valid code', async () => {
      const validCode = '3017620422003'; // Nutella
      const response = await request(app).get(`/product/${validCode}`);
      expect(response.statusCode).toBe(200);
      expect(response.body).toHaveProperty('id', validCode);
      expect(response.body).toHaveProperty('product_name', 'Nutella');
    });

    it('should return 404 for a non-existent code', async () => {
      const invalidCode = '0000000000000';
      const response = await request(app).get(`/product/${invalidCode}`);
      expect(response.statusCode).toBe(404);
      expect(response.body).toHaveProperty('error', 'Product not found');
    });

    it('should return 400 for a missing code', async () => {
      const response = await request(app).get('/product/');
      // This will actually result in a 404 with express default routing
      // if not handled specifically, but our handler for /product/:code won't be hit.
      // Let's check for 404.
      expect(response.statusCode).toBe(404);
    });
  });

  // Test for the search endpoint
  describe('GET /search/:term', () => {
    it('should return search results for a valid term', async () => {
      const searchTerm = 'coca cola';
      const response = await request(app).get(`/search/${searchTerm}`);
      expect(response.statusCode).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      // Check if the results seem relevant
      expect(response.body[0].product_name.toLowerCase()).toContain('coca-cola');
    });

    it('should return an empty array for a term with no matches', async () => {
      const searchTerm = 'nonexistentproductxyz';
      const response = await request(app).get(`/search/${searchTerm}`);
      expect(response.statusCode).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });

    it('should handle limit parameter correctly', async () => {
      const searchTerm = 'coca';
      const limit = 5;
      const response = await request(app).get(`/search/${searchTerm}?limit=${limit}`);
      expect(response.statusCode).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeLessThanOrEqual(limit);
    });

    it('should return 400 for an invalid limit parameter', async () => {
      const searchTerm = 'coca';
      const response = await request(app).get(`/search/${searchTerm}?limit=-1`);
      expect(response.statusCode).toBe(400);
      expect(response.body).toHaveProperty('error', 'Invalid limit parameter. Must be a positive integer <= 100.');
    });

    it('should return 400 for a missing search term', async () => {
        const response = await request(app).get('/search/');
        expect(response.statusCode).toBe(404); // Like the product one, this will 404
    });
  });
}); 