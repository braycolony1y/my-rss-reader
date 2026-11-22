import { cosineSimilarity, classifyE5Match, MatchDecision } from './similarity.js';

export function createAutoComponentPartition(nodes, yieldIfNeeded) {
  const finalAutoComponents = [];

  /*
   * Find the article with the strongest average
   * relationship to the rest of a component.
   *
   * Similarities are calculated when needed instead
   * of being stored for every global pair.
   */
  const chooseComponentMedoid =
    async indices => {
      if (
        indices.length <= 1
      ) {
        return indices[0];
      }

      const scores =
        new Float64Array(
          indices.length
        );

      let comparisons = 0;

      for (
        let left = 0;
        left < indices.length;
        left++
      ) {
        for (
          let right = left + 1;
          right < indices.length;
          right++
        ) {
          const leftIndex =
            indices[left];

          const rightIndex =
            indices[right];

          const similarity =
            nodes[leftIndex]
              .article
              ._vec &&
              nodes[rightIndex]
                .article
                ._vec
              ? cosineSimilarity(
                nodes[leftIndex]
                  .article
                  ._vec,
                nodes[rightIndex]
                  .article
                  ._vec
              )
              : 0;

          scores[left] +=
            similarity;

          scores[right] +=
            similarity;

          comparisons++;

          if (
            comparisons % 2000 ===
            0
          ) {
            await yieldIfNeeded(
              true
            );
          }
        }
      }

      let bestPosition = 0;

      for (
        let position = 1;
        position <
        indices.length;
        position++
      ) {
        const candidateId =
          nodes[
            indices[position]
          ].id;

        const bestId =
          nodes[
            indices[bestPosition]
          ].id;

        if (
          scores[position] >
          scores[bestPosition] ||
          (
            scores[position] ===
            scores[bestPosition] &&
            candidateId
              .localeCompare(
                bestId
              ) < 0
          )
        ) {
          bestPosition =
            position;
        }
      }

      return indices[
        bestPosition
      ];
    };

  /*
   * Rebuild connectivity only inside a component when
   * transitive chaining needs to be split. It uses
   * temporary O(component size) memory.
   */
  const partitionByDirectAutoLinks =
    async indices => {
      if (
        indices.length <= 1
      ) {
        return [indices];
      }

      const localParent =
        new Int32Array(
          indices.length
        );

      const localRank =
        new Uint8Array(
          indices.length
        );

      for (
        let index = 0;
        index < indices.length;
        index++
      ) {
        localParent[index] =
          index;
      }

      const localFind =
        index => {
          let root = index;

          while (
            localParent[root] !==
            root
          ) {
            root =
              localParent[root];
          }

          while (
            localParent[index] !==
            index
          ) {
            const next =
              localParent[index];

            localParent[index] =
              root;

            index = next;
          }

          return root;
        };

      const localUnion =
        (left, right) => {
          let leftRoot =
            localFind(left);

          let rightRoot =
            localFind(right);

          if (
            leftRoot === rightRoot
          ) {
            return;
          }

          if (
            localRank[leftRoot] <
            localRank[rightRoot]
          ) {
            [
              leftRoot,
              rightRoot
            ] = [
                rightRoot,
                leftRoot
              ];
          }

          localParent[rightRoot] =
            leftRoot;

          if (
            localRank[leftRoot] ===
            localRank[rightRoot]
          ) {
            localRank[leftRoot]++;
          }
        };

      let comparisons = 0;

      for (
        let left = 0;
        left < indices.length;
        left++
      ) {
        for (
          let right = left + 1;
          right < indices.length;
          right++
        ) {
          const leftIndex =
            indices[left];

          const rightIndex =
            indices[right];

          const similarity =
            nodes[leftIndex]
              .article
              ._vec &&
              nodes[rightIndex]
                .article
                ._vec
              ? cosineSimilarity(
                nodes[leftIndex]
                  .article
                  ._vec,
                nodes[rightIndex]
                  .article
                  ._vec
              )
              : 0;

          const classification =
            classifyE5Match(
              nodes[leftIndex]
                .article,
              nodes[rightIndex]
                .article,
              similarity
            );

          if (
            classification
              .decision ===
            MatchDecision
              .AUTO_MERGE
          ) {
            localUnion(
              left,
              right
            );
          }

          comparisons++;

          if (
            comparisons % 2000 ===
            0
          ) {
            await yieldIfNeeded(
              true
            );
          }
        }
      }

      const groups =
        new Map();

      for (
        let position = 0;
        position <
        indices.length;
        position++
      ) {
        const root =
          localFind(position);

        const group =
          groups.get(root);

        if (group) {
          group.push(
            indices[position]
          );
        } else {
          groups.set(
            root,
            [indices[position]]
          );
        }
      }

      return [
        ...groups.values()
      ];
    };

  /*
   * Prevent transitive chains from combining loosely
   * related events. Every article in an accepted
   * component must directly AUTO_MERGE with its medoid.
   */
  const splitComponent =
    async component => {
      await yieldIfNeeded();

      if (!component.length) {
        return;
      }

      if (
        component.length === 1
      ) {
        finalAutoComponents.push(
          component
        );

        return;
      }

      const medoid =
        await chooseComponentMedoid(
          component
        );

      const approved = [medoid];
      const remaining = [];

      for (
        const index
        of component
      ) {
        if (index === medoid) {
          continue;
        }

        const similarity =
          nodes[medoid]
            .article
            ._vec &&
            nodes[index]
              .article
              ._vec
            ? cosineSimilarity(
              nodes[medoid]
                .article
                ._vec,
              nodes[index]
                .article
                ._vec
            )
            : 0;

        const classification =
          classifyE5Match(
            nodes[medoid].article,
            nodes[index].article,
            similarity
          );

        if (
          classification.decision ===
          MatchDecision.AUTO_MERGE
        ) {
          approved.push(index);
        } else {
          remaining.push(index);
        }

        await yieldIfNeeded();
      }

      finalAutoComponents.push(
        approved
      );

      if (!remaining.length) {
        return;
      }

      const remainingComponents =
        await partitionByDirectAutoLinks(
          remaining
        );

      for (
        const subcomponent
        of remainingComponents
      ) {
        await splitComponent(
          subcomponent
        );
      }
    };


  return { splitComponent, getComponents: () => finalAutoComponents };
}
