import { createCatalogService } from '@kalisio/kdk-map-api'

export const services = async app => {
  await createCatalogService.call(app)
}
