import { z } from "zod";

/**JSON from OME-NGFF .zattrs*/
export const Image = z
  .object({
    /**The multiscale datasets for this image*/
    multiscales: z
      .array(
        z.object({
          name: z.string().optional(),
          datasets: z
            .array(
              z.object({
                path: z.string(),
                coordinateTransformations: z
                  .array(
                    z.any().superRefine((x, ctx) => {
                      const schemas = [
                        z.object({
                          type: z.literal("scale"),
                          scale: z.array(z.number()).min(2),
                        }),
                        z.object({
                          type: z.literal("translation"),
                          translation: z.array(z.number()).min(2),
                        }),
                      ];

                      const { errors, failed } = schemas.reduce<{
                        errors: z.core.$ZodIssue[];
                        failed: number;
                      }>(
                        ({ errors, failed }, schema) =>
                          ((result) =>
                            result.error
                              ? {
                                  errors: [...errors, ...result.error.issues],
                                  failed: failed + 1,
                                }
                              : { errors, failed })(schema.safeParse(x)),
                        { errors: [], failed: 0 }
                      );
                      if (schemas.length - failed !== 1) {
                        ctx.addIssue(
                          errors.length
                            ? {
                                code: "invalid_union",
                                errors: [errors],
                                message:
                                  "Invalid input: Should pass single schema",
                              }
                            : {
                                code: "custom",
                                message:
                                  "Invalid input: Should pass single schema",
                              }
                        );
                      }
                    })
                  )
                  .min(1),
              })
            )
            .min(1),
          version: z.literal("0.4").optional(),
          axes: z
            .array(
              z.any().superRefine((x, ctx) => {
                const schemas = [
                  z.object({
                    name: z.string(),
                    type: z.enum(["channel", "time", "space"]),
                  }),
                  z.object({
                    name: z.string(),
                    type: z
                      .any()
                      .refine(
                        (value) =>
                          !z.enum(["space", "time", "channel"]).safeParse(value)
                            .success,
                        "Invalid input: Should NOT be valid against schema"
                      )
                      .optional(),
                  }),
                ];

                const { errors, failed } = schemas.reduce<{
                  errors: z.core.$ZodIssue[];
                  failed: number;
                }>(
                  ({ errors, failed }, schema) =>
                    ((result) =>
                      result.error
                        ? {
                            errors: [...errors, ...result.error.issues],
                            failed: failed + 1,
                          }
                        : { errors, failed })(schema.safeParse(x)),
                  { errors: [], failed: 0 }
                );
                if (schemas.length - failed !== 1) {
                  ctx.addIssue(
                    errors.length
                      ? {
                          code: "invalid_union",
                          errors: [errors],
                          message: "Invalid input: Should pass single schema",
                        }
                      : {
                          code: "custom",
                          message: "Invalid input: Should pass single schema",
                        }
                  );
                }
              })
            )
            .min(2)
            .max(5),
          coordinateTransformations: z
            .array(
              z.any().superRefine((x, ctx) => {
                const schemas = [
                  z.object({
                    type: z.literal("scale"),
                    scale: z.array(z.number()).min(2),
                  }),
                  z.object({
                    type: z.literal("translation"),
                    translation: z.array(z.number()).min(2),
                  }),
                  // The JSON schema and my reading of the spec is that while
                  // identity is a valid transformation, it cannot be used here.
                  // However, some writers write it (e.g iohub), and it has no
                  // effect on the overall transformation, so we manually added
                  // after generation from the schema.
                  // See the following PR for more context:
                  // https://github.com/ome/ngff/pull/152
                  z.object({
                    type: z.literal("identity"),
                  }),
                ];

                const { errors, failed } = schemas.reduce<{
                  errors: z.core.$ZodIssue[];
                  failed: number;
                }>(
                  ({ errors, failed }, schema) =>
                    ((result) =>
                      result.error
                        ? {
                            errors: [...errors, ...result.error.issues],
                            failed: failed + 1,
                          }
                        : { errors, failed })(schema.safeParse(x)),
                  { errors: [], failed: 0 }
                );
                if (schemas.length - failed !== 1) {
                  ctx.addIssue(
                    errors.length
                      ? {
                          code: "invalid_union",
                          errors: [errors],
                          message: "Invalid input: Should pass single schema",
                        }
                      : {
                          code: "custom",
                          message: "Invalid input: Should pass single schema",
                        }
                  );
                }
              })
            )
            .min(1)
            .optional(),
        })
      )
      .min(1)
      .describe("The multiscale datasets for this image"),
    omero: z
      .object({
        channels: z.array(
          z.object({
            window: z.object({
              end: z.number(),
              max: z.number(),
              min: z.number(),
              start: z.number(),
            }),
            label: z.string().optional(),
            family: z.string().optional(),
            color: z.string(),
            active: z.boolean().optional(),
          })
        ),
        // The rdefs are not in the JSON schema and are not particularly well
        // described by the specification, but are written by some tools
        // (e.g. iohub), so we manually add them.
        // See the OMERO docs for more information:
        // https://docs.openmicroscopy.org/omero/5.6.1/developers/Web/WebGateway.html#rendering-settings
        rdefs: z
          .object({
            defaultT: z.number().optional(),
            defaultZ: z.number().optional(),
            color: z.enum(["color", "greyscale"]).optional(),
            projection: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .describe("JSON from OME-NGFF .zattrs");
export type Image = z.infer<typeof Image>;
