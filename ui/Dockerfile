FROM node:20-alpine

WORKDIR /app

# Copy package configuration
COPY package.json ./

# Install dependencies inside the container
RUN npm install

# Copy all remaining source files
COPY . .

# Expose Next.js default port
EXPOSE 3000

# Start Next.js development server
CMD ["npm", "run", "dev"]
