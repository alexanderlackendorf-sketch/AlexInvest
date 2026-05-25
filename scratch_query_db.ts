import prisma from './src/services/db';

async function query() {
  const stocks = await prisma.stock.findMany({
    where: { price: { gt: 0 } },
    select: { symbol: true, name: true, price: true, website: true, sector: true }
  });
  console.log(`Stocks with price > 0: ${stocks.length}`);
  console.log(stocks.slice(0, 10));

  const totalStocks = await prisma.stock.count();
  console.log(`Total stocks in DB: ${totalStocks}`);
}

query();
